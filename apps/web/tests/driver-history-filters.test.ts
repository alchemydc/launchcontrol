import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { buildDriverHistory, listSeasonsForDriver } from "@/lib/driver-history";
import { ensureLeagueAndSeasons } from "./helpers/league-fixture";

// Task 6: driver-stats league/time filters. Driver is global (one row per
// human); this suite pins the cross-league aggregation rules from the spec
// against a two-league fixture -- a driver with entries in BOTH leagues,
// including a pair of events that coincidentally share a calendar date
// across the two leagues (the combined-event non-merge fix).

const TEST_DB_PATH = resolve(__dirname, "..", "test-driver-history-filters.db");
const TEST_DB_URL = "file:./test-driver-history-filters.db";

let prisma: PrismaClient;
let leagueAId: number; // "pca-rmr" -- also the DEFAULT_LEAGUE_SLUG default
let leagueBId: number; // "league-b"
let seasonAId: number;
let seasonBId: number;
let crossDriverId: number; // entries in both leagues
let soloDriverId: number; // entries only in league A
let clashDriverId: number; // league A only, but races on dates league B also runs (#128)

async function makeEntry(
  eventId: number,
  driverId: number,
  classId: number,
  carNumber: string,
  rawTimeMs: number,
) {
  const entry = await prisma.entry.create({
    data: { eventId, driverId, classId, paxClassId: classId, carNumber },
  });
  await prisma.run.create({
    data: { entryId: entry.id, runNumber: 1, rawTimeMs, cones: 0, disposition: "CLEAN" },
  });
  return entry;
}

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  const leagueA = await ensureLeagueAndSeasons(prisma, [2026], "pca-rmr");
  const leagueB = await ensureLeagueAndSeasons(prisma, [2026], "league-b");
  leagueAId = leagueA.leagueId;
  leagueBId = leagueB.leagueId;
  seasonAId = leagueA.seasonIdByYear.get(2026)!;
  seasonBId = leagueB.seasonIdByYear.get(2026)!;

  const classA = await prisma.carClass.create({
    data: { leagueId: leagueAId, code: "C1", paxIndex: "1.0000" },
  });
  const classB = await prisma.carClass.create({
    data: { leagueId: leagueBId, code: "C1", paxIndex: "1.0000" },
  });

  const crossDriver = await prisma.driver.create({
    data: { firstName: "Cross", lastInitial: "X.", identityHash: "cross-driver-hash" },
  });
  const soloDriver = await prisma.driver.create({
    data: { firstName: "Solo", lastInitial: "Y.", identityHash: "solo-driver-hash" },
  });
  crossDriverId = crossDriver.id;
  soloDriverId = soloDriver.id;

  // League A events.
  const eventA1 = await prisma.event.create({
    data: { seasonId: seasonAId, slug: "a-jan-5", name: "A Jan Opener", date: new Date("2026-01-05T00:00:00.000Z") },
  });
  const eventA2 = await prisma.event.create({
    data: { seasonId: seasonAId, slug: "a-jan-12", name: "A Jan Round 2", date: new Date("2026-01-12T00:00:00.000Z") },
  });
  // Coincidentally shares a calendar date with League B's March event below.
  const eventA3 = await prisma.event.create({
    data: { seasonId: seasonAId, slug: "a-mar-1", name: "A March Clash", date: new Date("2026-03-01T00:00:00.000Z") },
  });

  // League B events.
  const eventB1 = await prisma.event.create({
    data: { seasonId: seasonBId, slug: "b-feb-10", name: "B Feb Round", date: new Date("2026-02-10T00:00:00.000Z") },
  });
  const eventB2 = await prisma.event.create({
    data: { seasonId: seasonBId, slug: "b-mar-1", name: "B March Clash", date: new Date("2026-03-01T00:00:00.000Z") },
  });

  // Cross driver: entries in every event across both leagues, including the
  // same-date (2026-03-01) pair split across leagues.
  await makeEntry(eventA1.id, crossDriverId, classA.id, "1", 60_000);
  await makeEntry(eventA2.id, crossDriverId, classA.id, "1", 59_000);
  await makeEntry(eventA3.id, crossDriverId, classA.id, "1", 58_000);
  await makeEntry(eventB1.id, crossDriverId, classB.id, "1", 61_000);
  await makeEntry(eventB2.id, crossDriverId, classB.id, "1", 57_000);

  // Solo driver: league A only.
  await makeEntry(eventA1.id, soloDriverId, classA.id, "2", 65_000);
  await makeEntry(eventA2.id, soloDriverId, classA.id, "2", 64_000);

  // Regression fixture for #128. The crossDriver above races in BOTH of the
  // same-date March events, and soloDriver races on neither date, so no group
  // is ever foreign to the subject — which is exactly why the pre-existing
  // suite could not catch the bug. clashDriver is the missing shape: they race
  // on a date the OTHER league also runs on, without entering the other
  // league's event.
  //
  // Two collisions, one per row builder:
  //   2026-03-01 — league B has one session there (eventB2)  -> single path
  //   2026-04-05 — league B has two sessions there           -> combined path
  //
  // League B's new events deliberately have no crossDriver entries, so every
  // assertion above still sees the same league-B history it did before: dates
  // are discovered from the subject's OWN entries, and crossDriver has none in
  // April.
  const eventA4 = await prisma.event.create({
    data: { seasonId: seasonAId, slug: "a-apr-5", name: "A April Clash", date: new Date("2026-04-05T00:00:00.000Z") },
  });
  await prisma.event.create({
    data: { seasonId: seasonBId, slug: "b-apr-5-am", name: "B April Clash (AM)", date: new Date("2026-04-05T00:00:00.000Z") },
  });
  await prisma.event.create({
    data: { seasonId: seasonBId, slug: "b-apr-5-pm", name: "B April Clash (PM)", date: new Date("2026-04-05T00:00:00.000Z") },
  });

  const clashDriver = await prisma.driver.create({
    data: { firstName: "Clash", lastInitial: "Z.", identityHash: "clash-driver-hash" },
  });
  clashDriverId = clashDriver.id;
  await makeEntry(eventA3.id, clashDriverId, classA.id, "3", 63_000);
  await makeEntry(eventA4.id, clashDriverId, classA.id, "3", 62_000);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("buildDriverHistory — league/time filters", () => {
  it("defaults to the DEFAULT_LEAGUE_SLUG league (pca-rmr), all time, when no filter is given", async () => {
    const history = await buildDriverHistory(crossDriverId, {}, prisma);
    expect(history.map((r) => r.eventSlug).sort()).toEqual(["a-jan-12", "a-jan-5", "a-mar-1"]);
    expect(history.every((r) => r.leagueSlug === "pca-rmr")).toBe(true);
  });

  it("scopes to a single explicit league (leagueIds: [id])", async () => {
    const historyA = await buildDriverHistory(crossDriverId, { leagueIds: [leagueAId] }, prisma);
    const historyB = await buildDriverHistory(crossDriverId, { leagueIds: [leagueBId] }, prisma);
    expect(historyA).toHaveLength(3);
    expect(historyA.every((r) => r.leagueId === leagueAId)).toBe(true);
    expect(historyB).toHaveLength(2);
    expect(historyB.every((r) => r.leagueId === leagueBId)).toBe(true);
  });

  it("'all' aggregates every league's events into one chronologically ordered list", async () => {
    const history = await buildDriverHistory(crossDriverId, { leagueIds: "all" }, prisma);
    expect(history).toHaveLength(5);
    expect(history.map((r) => r.eventDate.toISOString().slice(0, 10))).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-02-10",
      "2026-03-01",
      "2026-03-01",
    ]);
    // Cross-league aggregation rule: counts combine across leagues.
    expect(history.filter((r) => r.leagueId === leagueAId)).toHaveLength(3);
    expect(history.filter((r) => r.leagueId === leagueBId)).toHaveLength(2);
  });

  it("never merges two different leagues' events sharing a calendar date into one combined row", async () => {
    const history = await buildDriverHistory(crossDriverId, { leagueIds: "all" }, prisma);
    const marchRows = history.filter((r) => r.eventDate.toISOString().slice(0, 10) === "2026-03-01");
    expect(marchRows).toHaveLength(2);
    expect(marchRows.every((r) => r.combined === false)).toBe(true);
    expect(marchRows.map((r) => r.leagueId).sort()).toEqual([leagueAId, leagueBId].sort((a, b) => a - b));
  });

  it("scopes to one season regardless of the leagueIds param", async () => {
    const history = await buildDriverHistory(
      crossDriverId,
      { seasonId: seasonAId, leagueIds: "all" },
      prisma,
    );
    expect(history.map((r) => r.eventSlug).sort()).toEqual(["a-jan-12", "a-jan-5", "a-mar-1"]);
  });

  it("applies a custom date range across every selected league", async () => {
    const history = await buildDriverHistory(
      crossDriverId,
      { leagueIds: "all", from: new Date("2026-01-10T00:00:00.000Z"), to: new Date("2026-02-28T00:00:00.000Z") },
      prisma,
    );
    expect(history.map((r) => r.eventSlug).sort()).toEqual(["a-jan-12", "b-feb-10"]);
  });

  it("a single-league driver's default-league scope is unaffected by the second league existing", async () => {
    const history = await buildDriverHistory(soloDriverId, {}, prisma);
    expect(history).toHaveLength(2);
    expect(history.every((r) => r.leagueId === leagueAId)).toBe(true);
  });

  // Regression, #128. Groups are keyed (seasonId, dateKey), but the dates were
  // discovered per DATE — so under "all", the one scope whose where-clause is
  // empty by construction, another league's event on the same calendar date
  // formed a group the subject has no entry in. Both row builders assumed the
  // subject appears somewhere in every group handed to them and asserted it
  // with `!`, so the driver page 500'd on a property read of undefined.
  it("skips another league's same-date event the driver never entered ('all' scope)", async () => {
    const history = await buildDriverHistory(clashDriverId, { leagueIds: "all" }, prisma);
    expect(history.map((r) => r.eventSlug)).toEqual(["a-mar-1", "a-apr-5"]);
    expect(history.every((r) => r.leagueId === leagueAId)).toBe(true);
  });

  it("skips a foreign same-date COMBINED group too, not just a single event", async () => {
    // 2026-04-05 is two sessions in league B, so the foreign group takes the
    // combined path rather than the single-event one.
    const history = await buildDriverHistory(clashDriverId, { leagueIds: "all" }, prisma);
    const april = history.filter((r) => r.eventDate.toISOString().slice(0, 10) === "2026-04-05");
    expect(april).toHaveLength(1);
    expect(april[0]!.eventSlug).toBe("a-apr-5");
    expect(april[0]!.combined).toBe(false);
  });

  it("scoped queries were already correct and stay correct", async () => {
    const scoped = await buildDriverHistory(clashDriverId, { leagueIds: [leagueAId] }, prisma);
    expect(scoped.map((r) => r.eventSlug)).toEqual(["a-mar-1", "a-apr-5"]);
  });
});

describe("listSeasonsForDriver", () => {
  it("lists every season a cross-league driver has entries in, across both leagues", async () => {
    const seasons = await listSeasonsForDriver(crossDriverId, prisma);
    expect(seasons).toHaveLength(2);
    expect(seasons.map((s) => s.leagueSlug).sort()).toEqual(["league-b", "pca-rmr"]);
    expect(seasons.every((s) => s.year === 2026)).toBe(true);
  });

  it("lists only the driver's own league for a single-league driver", async () => {
    const seasons = await listSeasonsForDriver(soloDriverId, prisma);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.leagueSlug).toBe("pca-rmr");
    expect(seasons[0]!.seasonId).toBe(seasonAId);
  });

  it("returns an empty list for a driver with no entries", async () => {
    const ghost = await prisma.driver.create({
      data: { firstName: "Ghost", lastInitial: "Z.", identityHash: "ghost-driver-hash" },
    });
    const seasons = await listSeasonsForDriver(ghost.id, prisma);
    expect(seasons).toEqual([]);
  });
});
