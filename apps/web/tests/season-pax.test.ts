import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { buildSeasonLeaderboard, countedEventTarget } from "@/lib/season-leaderboard";
import { ensureLeagueAndSeasons, ensureRuleset } from "./helpers/league-fixture";

// Unique per-file DB path — see ingest.test.ts for the rationale.
const TEST_DB_PATH = resolve(__dirname, "..", "test-season-pax.db");
const TEST_DB_URL = "file:./test-season-pax.db";

const YEAR = 2026;

const FIXED_POLICY = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';
const FIXED_PAX_SECTION_POLICY = '{"v":2,"drops":"fixed","paxSection":true,"conePenaltyMs":2000}';

let prisma: PrismaClient;
let seasonId: number;
let conePenaltySeasonId: number;

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
  // Dedicated ruleset per test season (Task R2: policy lives on the ruleset,
  // read live) — so the setPolicy helpers below can't leak edits into the
  // other season through a shared ruleset row.
  await prisma.season.update({
    where: { id: seasonId },
    data: { rulesetId: await ensureRuleset(prisma, leagueId, { name: "Season Pax Rules", policy: FIXED_POLICY }) },
  });

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

  // Separate season (2027, same league) for the conePenaltyMs-threading
  // tests below: a single class ("CS") with two drivers whose relative
  // order flips depending on the per-cone penalty — Zoe strikes 2 cones,
  // Wendy is clean. Isolated from the YEAR/2026 fixture above so those
  // sections/tests (AS/BST/X, PAX ordering) are never touched by changing
  // this season's policy.
  const { seasonIdByYear: seasonIdByYear2027 } = await ensureLeagueAndSeasons(prisma, [
    { year: 2027 },
  ]);
  conePenaltySeasonId = seasonIdByYear2027.get(2027)!;
  await prisma.season.update({
    where: { id: conePenaltySeasonId },
    data: { rulesetId: await ensureRuleset(prisma, leagueId, { name: "Cone Penalty Rules", policy: FIXED_POLICY }) },
  });

  const cs = await prisma.carClass.create({ data: { leagueId, code: "CS", paxIndex: 0.9 } });
  const conePenaltyEvent = await prisma.event.create({
    data: {
      seasonId: conePenaltySeasonId,
      slug: "2027-cone-penalty-test",
      name: "Cone Penalty Test 2027#1",
      date: new Date("2027-04-18T00:00:00.000Z"),
    },
  });
  const [zoe, wendy] = await Promise.all([
    prisma.driver.create({ data: { firstName: "Zoe", lastInitial: "Z.", identityHash: "zoe-hash" } }),
    prisma.driver.create({ data: { firstName: "Wendy", lastInitial: "W.", identityHash: "wendy-hash" } }),
  ]);
  const conePenaltyEntrySpecs: Array<{ driverId: number; carNumber: string; ms: number; cones: number }> = [
    { driverId: zoe!.id, carNumber: "5", ms: 50000, cones: 2 },
    { driverId: wendy!.id, carNumber: "6", ms: 53000, cones: 0 },
  ];
  for (const spec of conePenaltyEntrySpecs) {
    const entry = await prisma.entry.create({
      data: {
        eventId: conePenaltyEvent.id,
        driverId: spec.driverId,
        classId: cs.id,
        paxClassId: cs.id,
        carNumber: spec.carNumber,
      },
    });
    await prisma.run.create({
      data: {
        entryId: entry.id,
        runNumber: 1,
        rawTimeMs: spec.ms,
        cones: spec.cones,
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
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  await prisma.scoringSystem.update({ where: { id: season.rulesetId }, data: { policy } });
}

describe("season PAX section (ruleset policy paxSection)", () => {
  // Task R1: class ranking is unconditionally on the applied-PAX-indexed
  // best time now — there's no more per-policy raw/pax toggle. A uniform-
  // factor class (AS: every entry's paxClass is AS itself) is a pure
  // rescale of the raw best, so it reproduces the exact pre-R1 "raw" points.
  // A mixed-factor run group (X: Xena's paxClass is DS, Yuri's is AST) now
  // always uses the official indexed order — this is the R1 behavior change
  // (previously only the "pax" ranking setting produced this; "raw"
  // incorrectly ranked X by unindexed raw time, with Yuri's faster raw
  // time winning).
  it("class sections rank on applied PAX unconditionally — uniform-factor classes reproduce the pre-R1 points; mixed-factor run groups use the official indexed order", async () => {
    await setPolicy(FIXED_POLICY);
    const result = await buildSeasonLeaderboard(YEAR, prisma);
    expect(result.sections.map((s) => s.classCode)).toEqual(["AS", "BST", "X"]);

    const as = result.sections.find((s) => s.classCode === "AS")!;
    // Same factor ⇒ pax metric is a pure rescale ⇒ identical points to raw.
    expect(as.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Alice A.", 1000],
      ["Carol C.", 952], // round(1000 × 40000 / 42000) — unchanged from raw
    ]);

    // Heterogeneous run group ⇒ official (indexed) order: Xena beats Yuri,
    // reversing the raw-time order (Yuri's raw 40500 < Xena's raw 41000).
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Xena X.", 1000],
      ["Yuri Y.", 982], // round(1000 × 33251 / 33858)
    ]);
  });

  it("preserves exact raw-time points for a uniform factor at an indexed-rounding boundary", async () => {
    const parityYear = 2028;
    const { leagueId, seasonIdByYear } = await ensureLeagueAndSeasons(prisma, [parityYear]);
    const paritySeasonId = seasonIdByYear.get(parityYear)!;
    await prisma.season.update({
      where: { id: paritySeasonId },
      data: {
        rulesetId: await ensureRuleset(prisma, leagueId, {
          name: "Uniform Factor Parity Rules",
          policy: FIXED_POLICY,
        }),
      },
    });

    const parityClass = await prisma.carClass.create({
      data: { leagueId, code: "PAR", paxIndex: 0.814 },
    });
    const parityEvent = await prisma.event.create({
      data: {
        seasonId: paritySeasonId,
        slug: "2028-uniform-factor-parity",
        name: "Uniform Factor Parity",
        date: new Date("2028-04-16T00:00:00.000Z"),
      },
    });
    const parityDrivers = await Promise.all([
      prisma.driver.create({
        data: { firstName: "Fast", lastInitial: "F.", identityHash: "uniform-parity-fast" },
      }),
      prisma.driver.create({
        data: { firstName: "Near", lastInitial: "N.", identityHash: "uniform-parity-near" },
      }),
    ]);

    for (const [index, rawTimeMs] of [30000, 30045].entries()) {
      const driver = parityDrivers[index]!;
      const entry = await prisma.entry.create({
        data: {
          eventId: parityEvent.id,
          driverId: driver.id,
          classId: parityClass.id,
          paxClassId: parityClass.id,
          carNumber: String(index + 1),
        },
      });
      await prisma.run.create({
        data: {
          entryId: entry.id,
          runNumber: 1,
          rawTimeMs,
          cones: 0,
          disposition: RunDisposition.CLEAN,
        },
      });
    }

    const result = await buildSeasonLeaderboard(parityYear, prisma);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Fast F.", 1000],
      ["Near N.", 999], // round(1000 × 30000 / 30045)
    ]);
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
});

describe("countedEventTarget (ruleset policy drops)", () => {
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

describe("conePenaltyMs threading (League Foundation PR 2 Task 7)", () => {
  async function setConePenaltyPolicy(policy: string) {
    const season = await prisma.season.findUniqueOrThrow({ where: { id: conePenaltySeasonId } });
    await prisma.scoringSystem.update({ where: { id: season.rulesetId }, data: { policy } });
  }

  it("a season's default 2000ms policy (matching CONE_PENALTY_MS) is the parity baseline", async () => {
    await setConePenaltyPolicy(
      '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}',
    );
    const result = await buildSeasonLeaderboard(2027, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    // Zoe: 50000 + 2×2000 = 54000. Wendy: 53000 (clean). Wendy is faster.
    expect(cs.drivers.map((d) => d.driverName)).toEqual(["Wendy W.", "Zoe Z."]);
    expect(cs.drivers[0]!.totalPoints).toBe(1000);
    expect(cs.drivers[1]!.totalPoints).toBe(981); // round(1000 × 53000 / 54000)
  });

  it("a 1000ms-penalty season scores this same matchup differently end-to-end — the win flips", async () => {
    await setConePenaltyPolicy(
      '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":1000}',
    );
    const result = await buildSeasonLeaderboard(2027, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    // Zoe: 50000 + 2×1000 = 52000, now faster than Wendy's clean 53000.
    expect(cs.drivers.map((d) => d.driverName)).toEqual(["Zoe Z.", "Wendy W."]);
    expect(cs.drivers[0]!.totalPoints).toBe(1000);
    expect(cs.drivers[1]!.totalPoints).toBe(981); // round(1000 × 52000 / 53000)
  });

  it("the same 1000ms penalty also flips the ruleset's synthetic overall-PAX section", async () => {
    await setConePenaltyPolicy(
      '{"v":2,"drops":"fixed","paxSection":true,"conePenaltyMs":1000}',
    );
    const result = await buildSeasonLeaderboard(2027, prisma);
    const pax = result.sections.find((s) => s.classCode === "PAX")!;
    // CS paxIndex 0.9: Zoe 52000×0.9=46800, Wendy 53000×0.9=47700 — Zoe wins.
    expect(pax.drivers.map((d) => d.driverName)).toEqual(["Zoe Z.", "Wendy W."]);
  });

  it("restoring the 2000ms policy restores the original (parity) order — the threading is not one-directional", async () => {
    await setConePenaltyPolicy(
      '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}',
    );
    const result = await buildSeasonLeaderboard(2027, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    expect(cs.drivers.map((d) => d.driverName)).toEqual(["Wendy W.", "Zoe Z."]);
  });

  it("the unrelated 2026 season fixture is unaffected by any of the above (default seasons unchanged)", async () => {
    // Reset to this file's baseline policy — a prior describe block left the
    // 2026 season's policy mutated, same as every other test in that block
    // does at its own start via setPolicy().
    await setPolicy(FIXED_POLICY);
    const result = await buildSeasonLeaderboard(YEAR, prisma);
    expect(result.sections.map((s) => s.classCode)).toEqual(["AS", "BST", "X"]);
    // X ranks by applied PAX unconditionally (Task R1) — Xena's indexed time
    // beats Yuri's, same official order as the earlier describe block.
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => d.driverName)).toEqual(["Xena X.", "Yuri Y."]);
  });
});
