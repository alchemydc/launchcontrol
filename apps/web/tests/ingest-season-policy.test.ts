import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";

// Task 7 (reworked by Task R2): an auto-created Season (no seeded row for the
// event's year) points its required rulesetId at the league's oldest
// ScoringSystem ruleset — a LIVE reference, not a snapshot. These tests pin
// two things the league-seed suite doesn't: (1) every auto-created season
// lands on the same (oldest) ruleset and reads whatever that ruleset says NOW
// — the live-reference contract, proven at the ingest boundary; (2) a league
// with no ScoringSystem at all fails loudly rather than falling back to
// anything.

const FIXTURES_DIR = resolve(__dirname, "fixtures");
// The migration chain canonicalizes the league-foundation seed's v1 policy
// through v2 and into this v3 shape.
const PCA_POLICY =
  '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,"points":{"type":"ratio1000","basis":"class"}}';

function migrateDeploy(dbUrl: string) {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}

describe("ingest points auto-created seasons at the league's oldest ruleset", () => {
  const TEST_DB_PATH = resolve(__dirname, "..", "test-ingest-season-policy.db");
  const TEST_DB_URL = "file:./test-ingest-season-policy.db";
  let prisma: PrismaClient;

  beforeAll(() => {
    rmSync(TEST_DB_PATH, { force: true });
    migrateDeploy(TEST_DB_URL);
    const adapter = new PrismaLibSql({ url: TEST_DB_URL });
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(TEST_DB_PATH, { force: true });
  });

  it("a fresh migrate+deploy carries the PCA Classic ruleset, canonicalized to v3 with a complete built-in paxTable", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: league.id } });
    expect(preset.name).toBe("PCA Classic");
    expect(JSON.parse(preset.policy)).toEqual(JSON.parse(PCA_POLICY));
    const table = JSON.parse(preset.paxTable) as Record<string, number>;
    expect(table.CS).toBe(0.814); // ruleset-centric migration seeds the full built-in table
    expect(table.AM).toBe(1);
  });

  it("auto-creates a 2026 Season pointing at the (only) ruleset", async () => {
    await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma); // event_date 2026-01-01
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: league.id } });
    const season2026 = await prisma.season.findFirstOrThrow({ where: { year: 2026 } });
    expect(season2026.rulesetId).toBe(preset.id);
  });

  it("editing the ruleset flows through LIVE to every season referencing it — earlier and later alike", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: league.id } });
    const editedPolicy =
      '{"v":4,"dropCount":4,"dropTiming":"proportional","paxSection":true,"conePenaltyMs":1500,"points":{"type":"ratio1000","basis":"class"}}';
    await prisma.scoringSystem.update({ where: { id: preset.id }, data: { policy: editedPolicy } });

    // A new year (2027), no Season row yet — auto-create lands on the same ruleset.
    await ingestAxdb(resolve(FIXTURES_DIR, "combined-event-1-opener.axdb"), prisma); // event_date 2027-03-01

    const season2027 = await prisma.season.findFirstOrThrow({
      where: { year: 2027 },
      include: { ruleset: true },
    });
    expect(season2027.rulesetId).toBe(preset.id);
    expect(season2027.ruleset.policy).toBe(editedPolicy);

    // The 2026 season, auto-created before the edit, reads the SAME edited
    // policy through its live ruleset reference — the old snapshot semantics
    // are gone by design (Task R2).
    const season2026 = await prisma.season.findFirstOrThrow({
      where: { year: 2026 },
      include: { ruleset: true },
    });
    expect(season2026.rulesetId).toBe(preset.id);
    expect(season2026.ruleset.policy).toBe(editedPolicy);
  });
});

describe("ingest throws when the league has no ScoringSystem preset", () => {
  const TEST_DB_PATH = resolve(__dirname, "..", "test-ingest-no-preset.db");
  const TEST_DB_URL = "file:./test-ingest-no-preset.db";
  let prisma: PrismaClient;

  beforeAll(async () => {
    rmSync(TEST_DB_PATH, { force: true });
    migrateDeploy(TEST_DB_URL);
    const adapter = new PrismaLibSql({ url: TEST_DB_URL });
    prisma = new PrismaClient({ adapter });
    // Remove every preset the migration seeded for the default league, simulating
    // a league that was never given a scoring system.
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    await prisma.scoringSystem.deleteMany({ where: { leagueId: league.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(TEST_DB_PATH, { force: true });
  });

  it("rejects ingest into a year with no Season and no ruleset to reference", async () => {
    await expect(
      ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma),
    ).rejects.toThrow(/has no ScoringSystem presets — create a scoring system for league 'pca-rmr' first/);

    // Nothing partial was left behind — the whole transaction rolled back.
    expect(await prisma.season.count()).toBe(0);
    expect(await prisma.event.count()).toBe(0);
  });
});
