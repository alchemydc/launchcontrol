import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { RMSOLO_PAX_2026 } from "@/lib/rmsolo-pax";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Task 3: ingestRmsoloEvent's { leagueSlug } targeting, and the isolation it
// buys — same class code, different leagues, different factors/seasons.
// Two-league end-to-end coexistence (PCA .axdb + RMsolo, driver aggregation,
// /leagues data-fn) is proven more broadly in Task 8's multi-league.test.ts;
// this file pins the ingest-layer isolation contract specifically.

const TEST_DB_PATH = resolve(__dirname, "..", "test-rmsolo-league-targeting.db");
const TEST_DB_URL = "file:./test-rmsolo-league-targeting.db";

let prisma: PrismaClient;
let otherLeagueId: number;

function event(carNumber: string): ParsedRmsoloEvent {
  return {
    title: "Summer 2026#1",
    classCodes: ["AS"],
    entries: [
      {
        classCode: "AS", position: 1, trophy: true, carNumber, altCarNumber: null,
        firstName: "Jamie", lastName: "Runner", carDescription: null, hometown: null,
        bestSeconds: 40.0,
        runs: [{ seconds: 40.0, cones: 0, disposition: "CLEAN" }],
      },
    ],
  };
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

  // A second league whose 2026 season's RULESET overrides "AS" to a factor
  // (0.5) nothing like the real RMSOLO_PAX_2026 AS value — unmistakable from
  // the default league's seeded built-in factor, and proof that a ruleset
  // paxTable override is itself league-scoped, not global.
  const otherLeague = await prisma.league.create({
    data: {
      slug: "rmsolo-test",
      name: "RMsolo Test League",
      siteTitle: "x",
      siteDescription: "x",
      landingDescription: "x",
      accessGate: "none",
    },
  });
  otherLeagueId = otherLeague.id;
  const otherRuleset = await prisma.scoringSystem.create({
    data: {
      leagueId: otherLeague.id,
      name: "RMsolo Default",
      policy: '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":2000}',
      paxTable: JSON.stringify({ ...RMSOLO_PAX_2026, AS: 0.5 }),
    },
  });
  await prisma.season.create({
    data: {
      leagueId: otherLeague.id,
      name: "2026 Season",
      slug: "2026-season",
      year: 2026,
      rulesetId: otherRuleset.id,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("ingestRmsoloEvent league targeting", () => {
  it("defaults to the DEFAULT_LEAGUE_SLUG league when leagueSlug is omitted", async () => {
    const result = await ingestRmsoloEvent({ parsed: event("1"), sha256: "default-league", date: "2026-05-01" }, prisma);
    expect(result.status).toBe("ingested");
    const pca = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const entry = await prisma.entry.findFirstOrThrow({ where: { carNumber: "1" }, include: { class: true } });
    expect(entry.class.leagueId).toBe(pca.id);
  });

  it("targets an explicit league via leagueSlug", async () => {
    const result = await ingestRmsoloEvent(
      { parsed: event("2"), sha256: "other-league", date: "2026-05-01", leagueSlug: "rmsolo-test" },
      prisma,
    );
    expect(result.status).toBe("ingested");
    const entry = await prisma.entry.findFirstOrThrow({ where: { carNumber: "2" }, include: { class: true } });
    expect(entry.class.leagueId).toBe(otherLeagueId);
  });

  it("isolates same-code CarClass rows per league with independent factors (a season's paxTable override is league-scoped, not global)", async () => {
    const pcaClass = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", league: { slug: "pca-rmr" } },
    });
    const otherClass = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", league: { slug: "rmsolo-test" } },
    });
    expect(pcaClass.id).not.toBe(otherClass.id);
    expect(Number(otherClass.paxIndex)).toBe(0.5); // this league's ruleset paxTable override
    expect(Number(pcaClass.paxIndex)).toBeGreaterThan(0.7); // pca-rmr has no such override — seeded built-in value
    expect(Number(pcaClass.paxIndex)).not.toBe(0.5);
  });

  it("isolates events/seasons per league — the same event date/name in each league gets its own Season and Event", async () => {
    const pcaEvent = await prisma.event.findFirstOrThrow({
      where: { slug: "2026-05-01-summer-2026-1", season: { league: { slug: "pca-rmr" } } },
      include: { season: true },
    });
    const otherEvent = await prisma.event.findFirstOrThrow({
      where: { slug: "2026-05-01-summer-2026-1", season: { league: { slug: "rmsolo-test" } } },
      include: { season: true },
    });
    expect(pcaEvent.id).not.toBe(otherEvent.id);
    expect(pcaEvent.season.leagueId).not.toBe(otherEvent.season.leagueId);
  });

  it("rejects an unknown league slug with a friendly error", async () => {
    await expect(
      ingestRmsoloEvent(
        { parsed: event("99"), sha256: "unknown-league", date: "2026-05-01", leagueSlug: "does-not-exist" },
        prisma,
      ),
    ).rejects.toThrow(/league 'does-not-exist' not found/);
  });
});
