import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { parseSeasonPaxTableStrict } from "@/lib/rmsolo-pax";
import { reapplySeasonPaxFactors } from "@/lib/pax-reapply";
import { ensureLeagueAndSeasons } from "./helpers/league-fixture";
import { dbTarget, migrateDeploy } from "./helpers/db";

describe("parseSeasonPaxTableStrict", () => {
  it("accepts a valid table", () => {
    expect(parseSeasonPaxTableStrict('{"AS":0.821}')).toEqual({ AS: 0.821 });
  });

  it.each(['"x"', "[1]", '{"AS":"a"}', '{"AS":0}', '{"AS":-1}', '{"AS":null}', "not json"])(
    "rejects %s",
    (bad) => expect(() => parseSeasonPaxTableStrict(bad)).toThrow(),
  );
});

describe("reapplySeasonPaxFactors", () => {
  const { path, url } = dbTarget("pax-reapply");
  let client: PrismaClient;
  let seasonAId: number;
  let seasonBId: number;
  let e1Id: number;
  let e2Id: number;
  let e3Id: number;

  beforeAll(async () => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });

    const { leagueId, seasonIdByYear } = await ensureLeagueAndSeasons(client, [
      { year: 2050, name: "Season A" },
      { year: 2051, name: "Season B" },
    ]);
    seasonAId = seasonIdByYear.get(2050)!;
    seasonBId = seasonIdByYear.get(2051)!;

    await client.season.update({
      where: { id: seasonAId },
      data: { paxTable: '{"AS":0.850}' },
    });
    // Season B keeps the default "{}" paxTable — used by the empty-table test.

    const [asClass, csClass] = await Promise.all([
      client.carClass.create({ data: { leagueId, code: "AS", paxIndex: 0.9 } }),
      client.carClass.create({ data: { leagueId, code: "CS", paxIndex: 0.8 } }),
    ]);

    const [eventA, eventB] = await Promise.all([
      client.event.create({
        data: {
          seasonId: seasonAId,
          slug: "season-a-event",
          name: "Season A Event",
          date: new Date("2050-04-18T00:00:00.000Z"),
        },
      }),
      client.event.create({
        data: {
          seasonId: seasonBId,
          slug: "season-b-event",
          name: "Season B Event",
          date: new Date("2051-04-18T00:00:00.000Z"),
        },
      }),
    ]);

    const driver = await client.driver.create({
      data: { firstName: "Alice", lastInitial: "A.", identityHash: "alice-hash-reapply" },
    });

    const e1 = await client.entry.create({
      data: {
        eventId: eventA.id,
        driverId: driver.id,
        classId: asClass.id,
        paxClassId: asClass.id,
        carNumber: "1",
        paxIndexApplied: 0.9,
      },
    });
    const e2 = await client.entry.create({
      data: {
        eventId: eventA.id,
        driverId: driver.id,
        classId: csClass.id,
        paxClassId: csClass.id,
        carNumber: "2",
        paxIndexApplied: 0.8,
      },
    });
    const e3 = await client.entry.create({
      data: {
        eventId: eventB.id,
        driverId: driver.id,
        classId: asClass.id,
        paxClassId: asClass.id,
        carNumber: "3",
        paxIndexApplied: 0.9,
      },
    });
    e1Id = e1.id;
    e2Id = e2.id;
    e3Id = e3.id;
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  async function get(id: number) {
    return client.entry.findUniqueOrThrow({ where: { id } });
  }

  it("rewrites only entries whose paxClass code is in the table, only in that season", async () => {
    const res = await reapplySeasonPaxFactors(client, seasonAId);
    expect(res).toEqual({ updated: 1, codes: ["AS"] });
    expect(Number((await get(e1Id)).paxIndexApplied)).toBe(0.85);
    expect(Number((await get(e2Id)).paxIndexApplied)).toBe(0.8); // code not in table
    expect(Number((await get(e3Id)).paxIndexApplied)).toBe(0.9); // other season untouched
  });

  it("empty paxTable is a no-op", async () => {
    expect(await reapplySeasonPaxFactors(client, seasonBId)).toEqual({ updated: 0, codes: [] });
  });

  it("does not touch an entry on seasonA's own event whose paxClass is a same-code CarClass in a different league", async () => {
    // Deliberately adversarial construction, built with raw prisma calls
    // (never producible by real ingest, which always keeps an entry's
    // paxClass in its own event's league): the entry's `eventId` is
    // seasonA's OWN event, so the `event: { seasonId }` half of the
    // where-clause alone would already match it — that half is not what's
    // under test here. Its `paxClassId` instead points at an "AS"
    // CarClass row created in a SECOND league. Only the
    // `paxClass: { ..., leagueId: season.leagueId }` guard can exclude
    // this entry; if that guard were deleted from the where-clause, this
    // entry would be caught by the `code: "AS"` match alone and rewritten
    // (and `res.updated` would read 2, not 1).
    const { leagueId: otherLeagueId } = await ensureLeagueAndSeasons(
      client,
      [{ year: 2060, name: "Other League Season" }],
      "other-league-pax-reapply",
    );

    const otherAsClass = await client.carClass.create({
      data: { leagueId: otherLeagueId, code: "AS", paxIndex: 0.9 },
    });

    const eventA = await client.event.findFirstOrThrow({ where: { seasonId: seasonAId } });
    const aliceDriver = await client.driver.findFirstOrThrow({
      where: { identityHash: "alice-hash-reapply" },
    });

    const adversarialEntry = await client.entry.create({
      data: {
        eventId: eventA.id, // seasonA's own event
        driverId: aliceDriver.id,
        classId: otherAsClass.id,
        paxClassId: otherAsClass.id, // ...but paxClass belongs to a different league
        carNumber: "99",
        paxIndexApplied: 0.9,
      },
    });

    const res = await reapplySeasonPaxFactors(client, seasonAId);
    expect(res).toEqual({ updated: 1, codes: ["AS"] }); // only the legit leagueA/AS entry (e1) — not 2
    expect(Number((await get(e1Id)).paxIndexApplied)).toBe(0.85); // legit seasonA/leagueA "AS" entry: rewritten
    expect(Number((await get(adversarialEntry.id)).paxIndexApplied)).toBe(0.9); // cross-league paxClass: untouched
  });
});
