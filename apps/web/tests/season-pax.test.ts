import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { buildSeasonLeaderboard, countedEventTarget } from "@/lib/season-leaderboard";
import { ensureLeagueAndSeasons } from "./helpers/league-fixture";

// Unique per-file DB path — see ingest.test.ts for the rationale.
const TEST_DB_PATH = resolve(__dirname, "..", "test-season-pax.db");
const TEST_DB_URL = "file:./test-season-pax.db";

const YEAR = 2026;

const FIXED_RAW_POLICY =
  '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';
const FIXED_PAX_SECTION_POLICY =
  '{"v":1,"drops":"fixed","paxSection":true,"classMetric":"raw","conePenaltyMs":2000}';
const FIXED_PAX_CLASSMETRIC_POLICY =
  '{"v":1,"drops":"fixed","paxSection":true,"classMetric":"pax","conePenaltyMs":2000}';

let prisma: PrismaClient;
let seasonId: number;

// One event, two standard classes plus an "X" run group whose raw and pax
// orders INVERT (the run-group correctness case), built via direct Prisma
// writes (no RMsolo ingest pipeline on this branch — that ports in a later
// PR). Reproduces the same numbers as the archive `feat/rmsolo-ingest`
// fixture:
//   AS  (0.830): Alice 40.000s → pax 33200ms   (overall PAX winner)
//               Carol 42.000s → pax 34860ms
//   BST (0.835): Bella 39.900s → pax 33317ms
//   X: Xena raw 41.000s, paxClass DS (0.811) → indexed 33251ms
//      Yuri raw 40.500s, paxClass AST (0.836) → indexed 33858ms
//      Raw order: Yuri < Xena. Official (indexed) order: Xena < Yuri.
beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  const { leagueId, seasonIdByYear } = await ensureLeagueAndSeasons(prisma, [YEAR]);
  seasonId = seasonIdByYear.get(YEAR)!;

  const [as, bst, x, ds, ast] = await Promise.all([
    prisma.carClass.create({ data: { leagueId, code: "AS", paxIndex: 0.83 } }),
    prisma.carClass.create({ data: { leagueId, code: "BST", paxIndex: 0.835 } }),
    prisma.carClass.create({ data: { leagueId, code: "X", paxIndex: 1.0 } }),
    prisma.carClass.create({ data: { leagueId, code: "DS", paxIndex: 0.811 } }),
    prisma.carClass.create({ data: { leagueId, code: "AST", paxIndex: 0.836 } }),
  ]);

  const event = await prisma.event.create({
    data: {
      seasonId,
      slug: "2026-summer-1",
      name: "Summer 2026#1",
      date: new Date("2026-04-18T00:00:00.000Z"),
    },
  });

  const drivers = await Promise.all(
    [
      { firstName: "Alice", lastInitial: "A.", identityHash: "alice-hash" },
      { firstName: "Carol", lastInitial: "C.", identityHash: "carol-hash" },
      { firstName: "Bella", lastInitial: "B.", identityHash: "bella-hash" },
      { firstName: "Xena", lastInitial: "X.", identityHash: "xena-hash" },
      { firstName: "Yuri", lastInitial: "Y.", identityHash: "yuri-hash" },
    ].map((d) => prisma.driver.create({ data: d })),
  );
  const [alice, carol, bella, xena, yuri] = drivers;

  const entrySpecs: Array<{ driverId: number; classId: number; paxClassId: number; carNumber: string; ms: number }> = [
    { driverId: alice!.id, classId: as.id, paxClassId: as.id, carNumber: "1", ms: 40000 },
    { driverId: carol!.id, classId: as.id, paxClassId: as.id, carNumber: "3", ms: 42000 },
    { driverId: bella!.id, classId: bst.id, paxClassId: bst.id, carNumber: "2", ms: 39900 },
    { driverId: xena!.id, classId: x.id, paxClassId: ds.id, carNumber: "9", ms: 41000 },
    { driverId: yuri!.id, classId: x.id, paxClassId: ast.id, carNumber: "8", ms: 40500 },
  ];

  for (const spec of entrySpecs) {
    const entry = await prisma.entry.create({
      data: {
        eventId: event.id,
        driverId: spec.driverId,
        classId: spec.classId,
        paxClassId: spec.paxClassId,
        carNumber: spec.carNumber,
      },
    });
    await prisma.run.create({
      data: {
        entryId: entry.id,
        runNumber: 1,
        rawTimeMs: spec.ms,
        cones: 0,
        disposition: RunDisposition.CLEAN,
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

async function setPolicy(policy: string) {
  await prisma.season.update({ where: { id: seasonId }, data: { scoringPolicy: policy } });
}

describe("season PAX section (Season.scoringPolicy.paxSection)", () => {
  it("is absent by default — leaderboard unchanged, run-group ranked by raw", async () => {
    await setPolicy(FIXED_RAW_POLICY);
    const result = await buildSeasonLeaderboard(YEAR, prisma);
    expect(result.sections.map((s) => s.classCode)).toEqual(["AS", "BST", "X"]);
    // Default (raw) metric: Yuri's faster RAW time wins X.
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => d.driverName)).toEqual(["Yuri Y.", "Xena X."]);
    expect(x.drivers[0]!.totalPoints).toBe(1000);
    expect(x.drivers[1]!.totalPoints).toBe(988); // round(1000 × 40500 / 41000)
  });

  it("adds an overall PAX section pinned first when enabled", async () => {
    await setPolicy(FIXED_PAX_SECTION_POLICY);
    const result = await buildSeasonLeaderboard(YEAR, prisma);
    expect(result.sections.map((s) => s.classCode)).toEqual(["PAX", "AS", "BST", "X"]);

    const pax = result.sections[0]!;
    expect(pax.drivers).toHaveLength(5);
    expect(pax.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Alice A.", 1000],
      ["Xena X.", 998], // round(1000 × 33200 / 33251)
      ["Bella B.", 996], // round(1000 × 33200 / 33317)
      ["Yuri Y.", 981], // round(1000 × 33200 / 33858)
      ["Carol C.", 952], // round(1000 × 33200 / 34860)
    ]);
  });

  it("classMetric=pax: uniform-factor class sections keep identical points; run groups rank by pax", async () => {
    await setPolicy(FIXED_PAX_CLASSMETRIC_POLICY);
    const result = await buildSeasonLeaderboard(YEAR, prisma);
    const as = result.sections.find((s) => s.classCode === "AS")!;
    // Same factor ⇒ pax metric is a pure rescale ⇒ identical points to raw.
    expect(as.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Alice A.", 1000],
      ["Carol C.", 952], // round(1000 × 40000 / 42000) — unchanged from raw
    ]);
    // Heterogeneous run group ⇒ official (indexed) order: Xena beats Yuri.
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Xena X.", 1000],
      ["Yuri Y.", 982], // round(1000 × 33251 / 33858)
    ]);
  });
});

describe("countedEventTarget (scoringPolicy.drops)", () => {
  it("fixed mode counts the qualifying threshold regardless of progress", () => {
    expect(countedEventTarget(10, 6, 5, "fixed")).toBe(6);
    expect(countedEventTarget(6, 4, 3, "fixed")).toBe(4);
  });

  it("proportional mode scales drops with completed events", () => {
    expect(countedEventTarget(10, 6, 5, "proportional")).toBe(3); // half season → half of 4 drops
    expect(countedEventTarget(10, 6, 10, "proportional")).toBe(6); // full season → best 6 of 10
    expect(countedEventTarget(10, 6, 1, "proportional")).toBe(1);
    expect(countedEventTarget(10, 6, 7, "proportional")).toBe(5); // 7 - floor(7×4/10)=7-2
  });

  it("degenerate seasons never drop below one counted event", () => {
    expect(countedEventTarget(0, 0, 0, "proportional")).toBe(0);
    expect(countedEventTarget(2, 2, 1, "proportional")).toBe(1);
  });
});

describe("conePenaltyMs enforcement (unwired per-season cone math)", () => {
  it("rejects a policy whose conePenaltyMs differs from the shared CONE_PENALTY_MS constant", async () => {
    await setPolicy(
      '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":1000}',
    );
    await expect(buildSeasonLeaderboard(YEAR, prisma)).rejects.toThrow(
      /scoringPolicy\.conePenaltyMs=1000 differs from the shared CONE_PENALTY_MS constant \(2000ms\)/,
    );
    // Restore a valid policy so this mutation doesn't leak into any other
    // test that reuses this season row.
    await setPolicy(FIXED_RAW_POLICY);
  });
});
