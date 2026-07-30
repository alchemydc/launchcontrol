import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";
import { createSeason } from "@/lib/create-season";
import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import { isLeagueAdmin, isAnyLeagueAdmin, administeredLeagues } from "@/lib/admin";
import { DEFAULT_SCORING_POLICY } from "./helpers/league-fixture";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Task 8: cross-cutting integrity guarantees the per-task suites don't
// individually pin — every case here runs against a fresh `prisma migrate
// deploy` DB (never the shared dev DB), matching the convention in
// ingest-season-policy.test.ts and league-config.test.ts.

const FIXTURES_DIR = resolve(__dirname, "fixtures");

// ---------------------------------------------------------------------------
// 1. Live-reference semantics at the SEASON level, via the createSeason lib
// (Task R2 inverted the old snapshot contract: seasons hold a rulesetId FK
// and read the ruleset's CURRENT policy at render time).
//
// ingest-season-policy.test.ts proves this at the ingest boundary
// (auto-created Seasons). This proves the same contract through the other
// Season-creation path: an operator explicitly calling createSeason().
// ---------------------------------------------------------------------------
describe("Season.rulesetId live-reference semantics (createSeason)", () => {
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

  it("editing the ScoringSystem ruleset after createSeason() flows through to every season referencing it", async () => {
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const preset = await client.scoringSystem.findFirstOrThrow({
      where: { leagueId: league.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(JSON.parse(preset.policy)).toEqual(JSON.parse(DEFAULT_SCORING_POLICY));

    const seasonA = await createSeason(
      { leagueSlug: "pca-rmr", name: "Live Ref Test A", year: 2040 },
      client,
    );
    expect(seasonA.rulesetId).toBe(preset.id);

    const editedPolicy =
      '{"v":4,"dropCount":2,"dropTiming":"proportional","paxSection":true,"conePenaltyMs":1500,"points":{"type":"ratio1000","basis":"class"}}';
    await client.scoringSystem.update({ where: { id: preset.id }, data: { policy: editedPolicy } });

    const seasonB = await createSeason(
      { leagueSlug: "pca-rmr", name: "Live Ref Test B", year: 2041 },
      client,
    );
    expect(seasonB.rulesetId).toBe(preset.id);

    // BOTH seasons read the edited policy through the shared live reference —
    // the old copy-at-creation snapshot semantics are gone by design.
    const reloadedA = await client.season.findUniqueOrThrow({
      where: { id: seasonA.id },
      include: { ruleset: true },
    });
    expect(reloadedA.ruleset.policy).toBe(editedPolicy);
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

  // PR 3, Task 10: scoring reads must use the Entry.paxIndexApplied snapshot
  // stamped at ingest, not a live join to CarClass.paxIndex — otherwise a
  // later rules-committee correction to a class's PAX factor would silently
  // reach back and re-score every past event that used it. paxSection is
  // switched on here (last test in this describe block, so it doesn't
  // disturb the assertions above): the synthetic PAX section pools entries
  // ACROSS classes by their paxIndex-adjusted time, so rescaling one class's
  // factor actually shifts cross-class ranking/points — unlike the ordinary
  // per-class ranking metric, which rescales every entry sharing a uniform
  // class factor by the same constant and so is order-invariant (see the
  // comment on the class ranking metric in season-leaderboard.ts), a
  // vacuous check that would pass even against a live join.
  it("editing CarClass.paxIndex after ingest no longer changes buildSeasonLeaderboard output", async () => {
    const season = await client.season.findFirstOrThrow({ where: { year: 2026 } });
    await client.scoringSystem.update({
      where: { id: season.rulesetId },
      data: {
        policy:
          '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":true,"conePenaltyMs":2000,"points":{"type":"ratio1000","basis":"class"}}',
      },
    });

    const before = await buildSeasonLeaderboard(2026, client);

    const usedEntry = await client.entry.findFirstOrThrow({
      where: { event: { seasonId: season.id } },
      select: { paxClassId: true },
    });
    await client.carClass.update({
      where: { id: usedEntry.paxClassId },
      data: { paxIndex: 0.123 },
    });

    const after = await buildSeasonLeaderboard(2026, client);
    expect(after).toEqual(before);
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
// 4. Per-league admin gates: isLeagueAdmin(uid, leagueId) is env-allowlist
// (superuser) OR a LeagueMembership(ADMIN) row FOR THAT SPECIFIC league —
// never neither, never a plain MEMBER role, and never an ADMIN row for a
// different league. isAnyLeagueAdmin(uid) gates the /admin entry: superuser
// OR an ADMIN row for any league.
// ---------------------------------------------------------------------------
describe("isLeagueAdmin() / isAnyLeagueAdmin()", () => {
  const { path, url } = dbTarget("integrity-membership-shim");
  let client: PrismaClient;
  const originalEnv = process.env.ADMIN_MSR_UIDS;
  let leagueId: number;
  let otherLeagueId: number;

  beforeAll(async () => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    leagueId = league.id;
    const other = await client.league.create({
      data: {
        slug: "membership-other-league",
        name: "Other League",
        siteTitle: "Other",
        siteDescription: "Other league test fixture.",
        landingDescription: "Other league test fixture.",
      },
    });
    otherLeagueId = other.id;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_MSR_UIDS;
    else process.env.ADMIN_MSR_UIDS = originalEnv;
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("env-only uid (no membership row) is a league admin", async () => {
    process.env.ADMIN_MSR_UIDS = "ENV-ONLY-UID";
    expect(await isLeagueAdmin("ENV-ONLY-UID", leagueId, client)).toBe(true);
  });

  it("membership-row-only uid (ADMIN role, not in env) is a league admin", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "ROW-ONLY-ADMIN-UID", role: "ADMIN" },
    });
    expect(await isLeagueAdmin("ROW-ONLY-ADMIN-UID", leagueId, client)).toBe(true);
  });

  it("uid satisfying both env and an ADMIN row is a league admin", async () => {
    process.env.ADMIN_MSR_UIDS = "BOTH-UID";
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "BOTH-UID", role: "ADMIN" },
    });
    expect(await isLeagueAdmin("BOTH-UID", leagueId, client)).toBe(true);
  });

  it("uid satisfying neither is not a league admin", async () => {
    process.env.ADMIN_MSR_UIDS = "SOME-OTHER-UID";
    expect(await isLeagueAdmin("NEITHER-UID", leagueId, client)).toBe(false);
  });

  it("a MEMBER-role membership row does not grant league admin", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "MEMBER-ROLE-UID", role: "MEMBER" },
    });
    expect(await isLeagueAdmin("MEMBER-ROLE-UID", leagueId, client)).toBe(false);
  });

  it("an ADMIN row on league A does not grant isLeagueAdmin on league B", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "LEAGUE-A-ADMIN-UID", role: "ADMIN" },
    });
    expect(await isLeagueAdmin("LEAGUE-A-ADMIN-UID", leagueId, client)).toBe(true);
    expect(await isLeagueAdmin("LEAGUE-A-ADMIN-UID", otherLeagueId, client)).toBe(false);
  });

  it("isAnyLeagueAdmin is true for an ADMIN of any league, false for a MEMBER-only user", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId: otherLeagueId, msrUid: "ANY-ADMIN-UID", role: "ADMIN" },
    });
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "ANY-MEMBER-UID", role: "MEMBER" },
    });
    expect(await isAnyLeagueAdmin("ANY-ADMIN-UID", client)).toBe(true);
    expect(await isAnyLeagueAdmin("ANY-MEMBER-UID", client)).toBe(false);
  });

  it("administeredLeagues returns every league (name-ordered) for a superuser", async () => {
    process.env.ADMIN_MSR_UIDS = "ADMINISTERED-SUPER-UID";
    const result = await administeredLeagues("ADMINISTERED-SUPER-UID", client);
    const slugs = result.map((l) => l.slug);
    expect(slugs).toContain("pca-rmr");
    expect(slugs).toContain("membership-other-league");
    // Name-ordered, ascending.
    const names = result.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("administeredLeagues returns only ADMIN-row leagues for a non-superuser, name-ordered", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    await client.leagueMembership.create({
      data: { leagueId: otherLeagueId, msrUid: "ADMINISTERED-ROW-UID", role: "ADMIN" },
    });
    // Also give it a MEMBER (not ADMIN) row on the other league — should not appear.
    await client.leagueMembership.create({
      data: { leagueId, msrUid: "ADMINISTERED-ROW-MEMBER-ONLY-UID", role: "MEMBER" },
    });
    const result = await administeredLeagues("ADMINISTERED-ROW-UID", client);
    expect(result.map((l) => l.slug)).toEqual(["membership-other-league"]);

    const memberOnly = await administeredLeagues("ADMINISTERED-ROW-MEMBER-ONLY-UID", client);
    expect(memberOnly).toEqual([]);
  });

  it("administeredLeagues returns [] for a missing msrUid", async () => {
    expect(await administeredLeagues(undefined, client)).toEqual([]);
    expect(await administeredLeagues(null, client)).toEqual([]);
    expect(await administeredLeagues("", client)).toEqual([]);
  });
});
