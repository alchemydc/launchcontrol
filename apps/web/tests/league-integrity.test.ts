import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";
import { createSeason } from "@/lib/create-season";
import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import { isAdmin } from "@/lib/admin";
import { DEFAULT_SCORING_POLICY } from "./helpers/league-fixture";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Task 8: cross-cutting integrity guarantees the per-task suites don't
// individually pin — every case here runs against a fresh `prisma migrate
// deploy` DB (never the shared dev DB), matching the convention in
// ingest-season-policy.test.ts and league-config.test.ts.

const FIXTURES_DIR = resolve(__dirname, "fixtures");

// ---------------------------------------------------------------------------
// 1. Snapshot semantics at the SEASON level, via the createSeason lib.
//
// Task 7 already proved this at the ingest boundary (auto-created Seasons).
// This proves the same "snapshot, not a live reference" contract through the
// other Season-creation path: an operator explicitly calling createSeason().
// ---------------------------------------------------------------------------
describe("Season.scoringPolicy snapshot semantics (createSeason)", () => {
  const { path, url } = dbTarget("integrity-season-snapshot");
  let client: PrismaClient;

  beforeAll(() => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("editing the ScoringSystem preset after createSeason() leaves the earlier Season's policy untouched", async () => {
    const seasonA = await createSeason(
      { leagueSlug: "pca-rmr", name: "Snapshot Test A", year: 2040 },
      client,
    );
    expect(seasonA.scoringPolicy).toBe(DEFAULT_SCORING_POLICY);

    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await client.scoringSystem.findFirstOrThrow({
      where: { leagueId: league.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const editedPolicy =
      '{"v":1,"drops":"proportional","paxSection":true,"classMetric":"pax","conePenaltyMs":1500}';
    await client.scoringSystem.update({ where: { id: preset.id }, data: { policy: editedPolicy } });

    const seasonB = await createSeason(
      { leagueSlug: "pca-rmr", name: "Snapshot Test B", year: 2041 },
      client,
    );
    expect(seasonB.scoringPolicy).toBe(editedPolicy);

    // The earlier season, created before the edit, must still read the
    // original value — proves scoringPolicy is copied at creation, never a
    // live reference to the ScoringSystem row it was sourced from.
    const reloadedA = await client.season.findUniqueOrThrow({ where: { id: seasonA.id } });
    expect(reloadedA.scoringPolicy).toBe(DEFAULT_SCORING_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 2. Seed parity: fresh migrate+deploy + the existing multi-event fixture
// (season-leaderboard.test.ts's 6-event fixture) must produce the exact
// same buildSeasonLeaderboard(2026) numbers main produces. Pinned as plain
// literals (not a vitest snapshot file) so a regression shows a readable
// diff against values a human chose, not opaque serialized JSON.
// ---------------------------------------------------------------------------
describe("seed parity: buildSeasonLeaderboard(2026) matches main's fixture expectations", () => {
  const { path, url } = dbTarget("integrity-seed-parity");
  let client: PrismaClient;

  beforeAll(async () => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });

    const events = [
      "season-event-1.axdb",
      "season-event-2.axdb",
      "season-event-3.axdb",
      "season-event-4.axdb",
      "season-event-5.axdb",
      "season-event-6.axdb",
    ];
    for (const filename of events) {
      await ingestAxdb(resolve(FIXTURES_DIR, filename), client);
    }
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("pins totals, threshold, and section shape", async () => {
    const result = await buildSeasonLeaderboard(2026, client);

    expect(result.totalEvents).toBe(6);
    expect(result.qualifyingEvents).toBe(4);
    expect(result.completedEvents).toBe(6);

    const codes = result.sections.map((s) => s.classCode).sort();
    expect(codes).toEqual(["C1", "CS"]);

    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    expect(
      c1.drivers.map((d) => ({ name: d.driverName, totalPoints: d.totalPoints, eligible: d.eligible })),
    ).toEqual([
      { name: "Alex A.", totalPoints: 4000, eligible: true },
      { name: "Bea B.", totalPoints: 3803, eligible: true },
      { name: "Dee D.", totalPoints: 1744, eligible: false },
      { name: "Evan E.", totalPoints: 806, eligible: false },
    ]);

    const cs = result.sections.find((s) => s.classCode === "CS")!;
    expect(
      cs.drivers.map((d) => ({ name: d.driverName, totalPoints: d.totalPoints, eligible: d.eligible })),
    ).toEqual([
      { name: "Fred F.", totalPoints: 3797, eligible: true },
      { name: "Gina G.", totalPoints: 3766, eligible: true },
      { name: "Cam C.", totalPoints: 3000, eligible: false },
      { name: "Dee D.", totalPoints: 1967, eligible: false },
      { name: "Bea B.", totalPoints: 1000, eligible: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. CarClass cross-league isolation: the same class code in two different
// leagues is two independent rows (CarClass.@@unique is [leagueId, code],
// not [code] alone) — editing one league's PAX factor must never touch the
// other's.
// ---------------------------------------------------------------------------
describe("CarClass cross-league isolation", () => {
  const { path, url } = dbTarget("integrity-carclass-isolation");
  let client: PrismaClient;

  beforeAll(() => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("two leagues can each have a 'C1' CarClass with independent paxIndex values", async () => {
    const leagueA = await client.league.create({
      data: {
        slug: "isolation-league-a",
        name: "Isolation League A",
        siteTitle: "League A",
        siteDescription: "League A test fixture.",
        landingDescription: "League A test fixture.",
      },
    });
    const leagueB = await client.league.create({
      data: {
        slug: "isolation-league-b",
        name: "Isolation League B",
        siteTitle: "League B",
        siteDescription: "League B test fixture.",
        landingDescription: "League B test fixture.",
      },
    });

    const classA = await client.carClass.create({
      data: { leagueId: leagueA.id, code: "C1", paxIndex: 0.83 },
    });
    const classB = await client.carClass.create({
      data: { leagueId: leagueB.id, code: "C1", paxIndex: 0.85 },
    });

    expect(classA.id).not.toBe(classB.id);
    expect(classA.code).toBe("C1");
    expect(classB.code).toBe("C1");
    expect(Number(classA.paxIndex)).toBeCloseTo(0.83, 4);
    expect(Number(classB.paxIndex)).toBeCloseTo(0.85, 4);

    await client.carClass.update({ where: { id: classA.id }, data: { paxIndex: 0.9 } });

    const reloadedA = await client.carClass.findUniqueOrThrow({ where: { id: classA.id } });
    const reloadedB = await client.carClass.findUniqueOrThrow({ where: { id: classB.id } });
    expect(Number(reloadedA.paxIndex)).toBeCloseTo(0.9, 4);
    // League B's row must be completely unaffected by League A's update.
    expect(Number(reloadedB.paxIndex)).toBeCloseTo(0.85, 4);
  });
});

// ---------------------------------------------------------------------------
// 4. Membership shim: isAdmin() is env-allowlist OR LeagueMembership(ADMIN)
// for the default league — never neither, never a plain MEMBER role.
// ---------------------------------------------------------------------------
describe("isAdmin() membership shim", () => {
  const { path, url } = dbTarget("integrity-membership-shim");
  let client: PrismaClient;
  const originalEnv = process.env.ADMIN_MSR_UIDS;
  let leagueId: number;

  beforeAll(async () => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    leagueId = league.id;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_MSR_UIDS;
    else process.env.ADMIN_MSR_UIDS = originalEnv;
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("env-only uid (no membership row) is admin", async () => {
    process.env.ADMIN_MSR_UIDS = "ENV-ONLY-UID";
    expect(await isAdmin("ENV-ONLY-UID", client)).toBe(true);
  });

  it("membership-row-only uid (ADMIN role, not in env) is admin", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "ROW-ONLY-ADMIN-UID", role: "ADMIN" },
    });
    expect(await isAdmin("ROW-ONLY-ADMIN-UID", client)).toBe(true);
  });

  it("uid satisfying both env and an ADMIN row is admin", async () => {
    process.env.ADMIN_MSR_UIDS = "BOTH-UID";
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "BOTH-UID", role: "ADMIN" },
    });
    expect(await isAdmin("BOTH-UID", client)).toBe(true);
  });

  it("uid satisfying neither is not admin", async () => {
    process.env.ADMIN_MSR_UIDS = "SOME-OTHER-UID";
    expect(await isAdmin("NEITHER-UID", client)).toBe(false);
  });

  it("a MEMBER-role membership row does not grant admin", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "MEMBER-ROLE-UID", role: "MEMBER" },
    });
    expect(await isAdmin("MEMBER-ROLE-UID", client)).toBe(false);
  });
});
