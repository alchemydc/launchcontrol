import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createLeague } from "@/lib/create-league";
import { buildDriverHistory } from "@/lib/driver-history";
import { findEventBySlug } from "@/lib/event-queries";
import { ingestAxdb } from "@/lib/ingest";
import { listLeagueDirectory } from "@/lib/league-directory";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";
import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";

// Task 8: two-league coexistence, end-to-end, in ONE database. Uses the real
// CLIs' lib functions (createLeague, ingestAxdb, ingestRmsoloEvent,
// buildSeasonLeaderboard, buildDriverHistory, listLeagueDirectory,
// findEventBySlug) rather than raw Prisma writes -- the one deliberate
// exception is a season paxTable override below, which mirrors
// rmsolo-ingest-league-targeting.test.ts's proven mechanism (neither ingest
// path itself can express a paxTable override; it's operator/CLI-authored
// config, not ingest output).
//
// Topology -- three leagues, chosen deliberately:
//   - "pca-test"    (created via createLeague): PCA .axdb ingest --
//     tests/fixtures/synthetic.axdb (the smallest existing fixture builder's
//     committed output, same one tests/ingest.test.ts uses) -- 3 classes,
//     6 drivers, 1 event.
//   - "pca-rmr"     (the seeded default league): RMsolo ingest -- class AS,
//     two drivers: "Jamie Runner" and "Alex Ada". Alex Ada's displayed name
//     deliberately collides with pca-test's axdb driver "Alex Ada" (real
//     memberNum SYN-001) to pin the documented NON-merge: axdb identity
//     hashes (memberNum, first, last); RMsolo identity hashes (null, first,
//     last) -- same displayed name, different hash, so they must stay two
//     distinct Driver rows, never a false merge.
//   - "rmsolo-test" (created via createLeague): a SECOND RMsolo-sourced
//     league -- class AS again (with a season paxTable override, proving
//     CarClass same-code isolation) plus the SAME "Jamie Runner" (null
//     memberNum on both sides). RMsolo's identity hash never depends on
//     league, so this is a genuinely shared human by design -- exercised
//     through buildDriverHistory's cross-league aggregation rules (Task 6).
//
// Two RMsolo-sourced leagues are required for that genuinely-shared-driver
// proof: the minimal "one axdb league + one RMsolo league" story can't
// produce a null-memberNum name collision on both sides, since only one side
// would be RMsolo-sourced.

const TEST_DB_PATH = resolve(__dirname, "..", "test-multi-league.db");
const TEST_DB_URL = "file:./test-multi-league.db";
const AXDB_FIXTURE = resolve(__dirname, "fixtures", "synthetic.axdb");

let prisma: PrismaClient;

let pcaTestLeagueId: number;
let pcaRmrLeagueId: number; // seeded default league ("pca-rmr")
let rmsoloTestLeagueId: number;

const PCA_RMR_EVENT_SLUG = "2026-05-01-coexistence-test-event";
const RMSOLO_TEST_EVENT_SLUG = "2026-06-01-rmsolo-test-round-1";

function rmsoloEvent(
  entries: Array<{ carNumber: string; firstName: string; lastName: string; bestSeconds: number }>,
): ParsedRmsoloEvent {
  return {
    title: "Coexistence Test Event",
    classCodes: ["AS"],
    entries: entries.map((e, i) => ({
      classCode: "AS",
      position: i + 1,
      trophy: i === 0,
      carNumber: e.carNumber,
      altCarNumber: null,
      firstName: e.firstName,
      lastName: e.lastName,
      carDescription: null,
      hometown: null,
      bestSeconds: e.bestSeconds,
      runs: [{ seconds: e.bestSeconds, cones: 0, disposition: "CLEAN" as const }],
    })),
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

  // --- League 1: "pca-test" -- PCA .axdb ingest ---
  const pcaTest = await createLeague({ slug: "pca-test", name: "PCA Test League" }, prisma);
  pcaTestLeagueId = pcaTest.league.id;
  await ingestAxdb(AXDB_FIXTURE, prisma, { leagueSlug: "pca-test" });

  // --- League 2: "pca-rmr" -- the seeded default league, RMsolo ingest ---
  const pcaRmr = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
  pcaRmrLeagueId = pcaRmr.id;
  await ingestRmsoloEvent(
    {
      parsed: rmsoloEvent([
        { carNumber: "1", firstName: "Jamie", lastName: "Runner", bestSeconds: 40.0 },
        { carNumber: "2", firstName: "Alex", lastName: "Ada", bestSeconds: 42.0 },
      ]),
      sha256: "pca-rmr-event-sha",
      date: "2026-05-01",
    },
    prisma,
  ); // leagueSlug omitted -> DEFAULT_LEAGUE_SLUG ("pca-rmr")

  // --- League 3: "rmsolo-test" -- a second RMsolo-sourced league ---
  const rmsoloTest = await createLeague({ slug: "rmsolo-test", name: "RMsolo Test League" }, prisma);
  rmsoloTestLeagueId = rmsoloTest.league.id;
  // Pre-create the 2026 season with an AS paxTable override -- the only way
  // to force a same-code CarClass factor difference from pca-rmr's
  // built-in-table AS value (RMSOLO_PAX_2026.AS = 0.830); this is operator
  // config (like `season:create --paxTable`), not something either ingest
  // path produces itself. Reuses createLeague's own freshly-created preset
  // policy so the season isn't hand-authoring a disconnected policy.
  const rmsoloTestPreset = await prisma.scoringSystem.findFirstOrThrow({
    where: { leagueId: rmsoloTestLeagueId },
  });
  await prisma.season.create({
    data: {
      leagueId: rmsoloTestLeagueId,
      name: "2026 Season",
      slug: "2026-season",
      year: 2026,
      scoringPolicy: rmsoloTestPreset.policy,
      paxTable: JSON.stringify({ AS: 0.5 }),
    },
  });
  await ingestRmsoloEvent(
    {
      parsed: rmsoloEvent([{ carNumber: "1", firstName: "Jamie", lastName: "Runner", bestSeconds: 39.0 }]),
      sha256: "rmsolo-test-event-sha",
      date: "2026-06-01",
      name: "Rmsolo Test Round 1",
      leagueSlug: "rmsolo-test",
    },
    prisma,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("CarClass isolation", () => {
  it("the same class code (AS) in two different leagues resolves to distinct rows with independent factors", async () => {
    const pcaRmrAs = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", leagueId: pcaRmrLeagueId },
    });
    const rmsoloTestAs = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", leagueId: rmsoloTestLeagueId },
    });

    expect(pcaRmrAs.id).not.toBe(rmsoloTestAs.id);
    // pca-rmr has no paxTable override for AS -- built-in RMSOLO_PAX_2026 table.
    expect(Number(pcaRmrAs.paxIndex)).toBeCloseTo(0.83, 4);
    // rmsolo-test's season paxTable overrides AS to an unmistakably different value.
    expect(Number(rmsoloTestAs.paxIndex)).toBe(0.5);
  });

  it("updating one league's AS factor leaves the other league's AS class untouched", async () => {
    const pcaRmrAsBefore = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", leagueId: pcaRmrLeagueId },
    });
    const rmsoloTestAsBefore = await prisma.carClass.findFirstOrThrow({
      where: { code: "AS", leagueId: rmsoloTestLeagueId },
    });

    await prisma.carClass.update({ where: { id: rmsoloTestAsBefore.id }, data: { paxIndex: "0.777" } });

    const pcaRmrAsAfter = await prisma.carClass.findUniqueOrThrow({ where: { id: pcaRmrAsBefore.id } });
    expect(Number(pcaRmrAsAfter.paxIndex)).toBeCloseTo(0.83, 4);

    const rmsoloTestAsAfter = await prisma.carClass.findUniqueOrThrow({ where: { id: rmsoloTestAsBefore.id } });
    expect(Number(rmsoloTestAsAfter.paxIndex)).toBe(0.777);
  });
});

describe("standings isolation (buildSeasonLeaderboard)", () => {
  it("pca-test's leaderboard contains only pca-test's classes/drivers", async () => {
    const result = await buildSeasonLeaderboard({ leagueId: pcaTestLeagueId, year: 2026 }, prisma);

    expect(result.totalEvents).toBe(1);
    expect(result.completedEvents).toBe(1);
    expect(result.sections.map((s) => s.classCode).sort()).toEqual(["C1", "CS", "TO"]);

    const names = result.sections.flatMap((s) => s.drivers.map((d) => d.driverName));
    expect(names).toHaveLength(6); // 6 axdb drivers, one class each
    expect(names.some((n) => n.includes("Runner"))).toBe(false); // no RMsolo bleed-through
  });

  it("pca-rmr's leaderboard contains only pca-rmr's drivers -- not pca-test's, not rmsolo-test's", async () => {
    const result = await buildSeasonLeaderboard({ leagueId: pcaRmrLeagueId, year: 2026 }, prisma);

    expect(result.totalEvents).toBe(1);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.classCode).toBe("AS");
    expect(result.sections[0]!.drivers.map((d) => d.driverName).sort()).toEqual(["Alex A.", "Jamie R."]);
  });

  it("rmsolo-test's leaderboard contains only rmsolo-test's driver", async () => {
    const result = await buildSeasonLeaderboard({ leagueId: rmsoloTestLeagueId, year: 2026 }, prisma);

    expect(result.totalEvents).toBe(1);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.drivers.map((d) => d.driverName)).toEqual(["Jamie R."]);
  });
});

describe("league directory (listLeagueDirectory)", () => {
  it("lists all three leagues with correct active-season summaries", async () => {
    const directory = await listLeagueDirectory(prisma);
    expect(directory).toHaveLength(3);

    const bySlug = new Map(directory.map((d) => [d.slug, d]));
    expect(bySlug.get("pca-test")).toMatchObject({ activeSeasonName: "2026 Season", eventCount: 1 });
    expect(bySlug.get("pca-rmr")).toMatchObject({ activeSeasonName: "2026 Season", eventCount: 1 });
    expect(bySlug.get("rmsolo-test")).toMatchObject({ activeSeasonName: "2026 Season", eventCount: 1 });
  });
});

describe("cross-league driver identity", () => {
  it("does NOT merge same-named drivers across an axdb source and an RMsolo source (documented non-merge)", async () => {
    // axdb identityHash = hash(memberNum, first, last); RMsolo's = hash(null, first, last).
    // Same displayed name ("Alex Ada"), different hash -- must stay two rows.
    const axdbAlex = await prisma.driver.findFirstOrThrow({
      where: { firstName: "Alex", lastInitial: "A.", memberNum: "SYN-001" },
    });
    const rmsoloAlex = await prisma.driver.findFirstOrThrow({
      where: { firstName: "Alex", lastInitial: "A.", memberNum: null },
    });

    expect(axdbAlex.id).not.toBe(rmsoloAlex.id);
    expect(axdbAlex.identityHash).not.toBe(rmsoloAlex.identityHash);

    const allAlexAdas = await prisma.driver.findMany({ where: { firstName: "Alex", lastInitial: "A." } });
    expect(allAlexAdas).toHaveLength(2);
  });

  it("DOES merge the same RMsolo-sourced driver across two RMsolo leagues (null-memberNum name-hash collision, by design)", async () => {
    const jamies = await prisma.driver.findMany({ where: { firstName: "Jamie", lastInitial: "R." } });
    expect(jamies).toHaveLength(1);

    const entries = await prisma.entry.findMany({
      where: { driverId: jamies[0]!.id },
      include: { event: { include: { season: true } } },
    });
    const leagueIds = entries.map((e) => e.event.season.leagueId).sort((a, b) => a - b);
    expect(leagueIds).toEqual([pcaRmrLeagueId, rmsoloTestLeagueId].sort((a, b) => a - b));
  });

  it("buildDriverHistory({leagueIds:'all'}) aggregates the shared driver's entries across both leagues", async () => {
    const jamie = await prisma.driver.findFirstOrThrow({ where: { firstName: "Jamie", lastInitial: "R." } });
    const history = await buildDriverHistory(jamie.id, { leagueIds: "all" }, prisma);

    expect(history).toHaveLength(2);
    expect(history.map((r) => r.leagueId).sort((a, b) => a - b)).toEqual(
      [pcaRmrLeagueId, rmsoloTestLeagueId].sort((a, b) => a - b),
    );
  });

  it("a per-league filter isolates the shared driver's history to just that league", async () => {
    const jamie = await prisma.driver.findFirstOrThrow({ where: { firstName: "Jamie", lastInitial: "R." } });

    const historyPcaRmr = await buildDriverHistory(jamie.id, { leagueIds: [pcaRmrLeagueId] }, prisma);
    expect(historyPcaRmr).toHaveLength(1);
    expect(historyPcaRmr[0]!.leagueId).toBe(pcaRmrLeagueId);

    const historyRmsoloTest = await buildDriverHistory(jamie.id, { leagueIds: [rmsoloTestLeagueId] }, prisma);
    expect(historyRmsoloTest).toHaveLength(1);
    expect(historyRmsoloTest[0]!.leagueId).toBe(rmsoloTestLeagueId);
  });

  it("the default (no filter) scope resolves to the deployment's default league (pca-rmr) only", async () => {
    const jamie = await prisma.driver.findFirstOrThrow({ where: { firstName: "Jamie", lastInitial: "R." } });
    const history = await buildDriverHistory(jamie.id, {}, prisma);

    expect(history).toHaveLength(1);
    expect(history[0]!.leagueId).toBe(pcaRmrLeagueId);
  });
});

describe("legacy routes remain default-league-only (findEventBySlug)", () => {
  it("finds pca-rmr's own event by slug when scoped to the default league", async () => {
    const event = await findEventBySlug(pcaRmrLeagueId, PCA_RMR_EVENT_SLUG, prisma);
    expect(event).not.toBeNull();
    expect(event!.slug).toBe(PCA_RMR_EVENT_SLUG);
  });

  it("misses rmsolo-test's event slug when scoped to the default league -- no cross-league leakage", async () => {
    const event = await findEventBySlug(pcaRmrLeagueId, RMSOLO_TEST_EVENT_SLUG, prisma);
    expect(event).toBeNull();
  });

  it("rmsolo-test's own league does find that same slug when scoped to itself", async () => {
    const event = await findEventBySlug(rmsoloTestLeagueId, RMSOLO_TEST_EVENT_SLUG, prisma);
    expect(event).not.toBeNull();
  });
});
