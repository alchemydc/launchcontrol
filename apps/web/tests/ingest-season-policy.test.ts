import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";

// Task 7: an auto-created Season (no seeded row for the event's year) snapshots
// the league's ScoringSystem preset instead of a hardcoded policy string. These
// tests pin two things the league-seed suite doesn't: (1) the snapshot tracks
// whatever the preset currently says at auto-create time, and previously
// created seasons are untouched by a later preset edit — the "snapshot, not a
// live reference" contract, proven at the ingest boundary; (2) a league with no
// ScoringSystem preset at all fails loudly rather than falling back to anything.

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const PCA_POLICY = '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';

function migrateDeploy(dbUrl: string) {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
}

describe("ingest snapshots the league's current ScoringSystem preset", () => {
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

  it("a fresh migrate+deploy carries the PCA Classic preset unmodified", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: league.id } });
    expect(preset.name).toBe("PCA Classic");
    expect(preset.policy).toBe(PCA_POLICY);
  });

  it("auto-creates a 2026 Season snapshotting the (still-default) preset", async () => {
    await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma); // event_date 2026-01-01
    const season2026 = await prisma.season.findFirstOrThrow({ where: { year: 2026 } });
    expect(season2026.scoringPolicy).toBe(PCA_POLICY);
  });

  it("editing the preset afterward changes only a LATER auto-created season, not the earlier one", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: league.id } });
    const editedPolicy =
      '{"v":1,"drops":"proportional","paxSection":true,"classMetric":"pax","conePenaltyMs":1500}';
    await prisma.scoringSystem.update({ where: { id: preset.id }, data: { policy: editedPolicy } });

    // A new year (2027), no Season row yet — auto-create must pick up the edit.
    await ingestAxdb(resolve(FIXTURES_DIR, "combined-event-1-opener.axdb"), prisma); // event_date 2027-03-01

    const season2027 = await prisma.season.findFirstOrThrow({ where: { year: 2027 } });
    expect(season2027.scoringPolicy).toBe(editedPolicy);

    // The 2026 season, auto-created before the edit, must be untouched — proves
    // scoringPolicy is a snapshot copy, never a live reference to ScoringSystem.
    const season2026 = await prisma.season.findFirstOrThrow({ where: { year: 2026 } });
    expect(season2026.scoringPolicy).toBe(PCA_POLICY);
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

  it("rejects ingest into a year with no Season and no preset to snapshot", async () => {
    await expect(
      ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma),
    ).rejects.toThrow(/has no ScoringSystem presets — create a scoring system for league 'pca-rmr' first/);

    // Nothing partial was left behind — the whole transaction rolled back.
    expect(await prisma.season.count()).toBe(0);
    expect(await prisma.event.count()).toBe(0);
  });
});
