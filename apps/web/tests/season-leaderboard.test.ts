import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";
import {
  buildSeasonLeaderboard,
  listSeasonYears,
} from "@/lib/season-leaderboard";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";

const TEST_DB_PATH = resolve(__dirname, "..", "test-season.db");
const TEST_DB_URL = "file:./test-season.db";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const SEASON_EVENTS = [
  "season-event-1.axdb",
  "season-event-2.axdb",
  "season-event-3.axdb",
  "season-event-4.axdb",
  "season-event-5.axdb",
];

let prisma: PrismaClient;
let camId: number;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  // Ingest all 5 season events into the test DB.
  for (const filename of SEASON_EVENTS) {
    const path = resolve(FIXTURES_DIR, filename);
    await ingestAxdb(path, prisma);
  }

  const cam = await prisma.driver.findFirst({ where: { memberNum: "MES-003" } });
  camId = cam!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

// ---------------------------------------------------------------------------
// Fixture overview (documented in build-multi-event-season.mjs):
//
//  Alex  (C1, 5 events)  → 1000 × 5, best 4 = 4000, 1 dropped
//  Bea   (C1, 4 events + CS event 5 off-class) → 909 + 962 + 963 + 930 = 3764
//  Cam   (CS, 3 events + DNF at event 5) → 1000 × 3 = 3000, eligible=false
//  Dee   (2 C1 + 2 CS → tiebreak C1) → 833 + 911 = 1744
//  Evan  (C1, 1 event)  → 806, eligible=false
// ---------------------------------------------------------------------------

describe("buildSeasonLeaderboard(2026)", () => {
  it("returns C1 and CS sections only", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const codes = standings.map((s) => s.classCode).sort();
    expect(codes).toEqual(["C1", "CS"]);
  });

  it("class C1 is sorted: Alex first (most points), then Bea, Dee, Evan", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1");
    expect(c1).toBeDefined();
    const names = c1!.drivers.map((d) => d.driverName);
    // Alex: 4000, Bea: 3764, Dee: 1744, Evan: 806
    expect(names[0]).toBe("Alex A.");
    expect(names[1]).toBe("Bea B.");
    expect(names[2]).toBe("Dee D.");
    expect(names[3]).toBe("Evan E.");
  });

  // Assertion 1: Fastest driver in class = 1000 pts for every (event, class) group.
  it("fastest in class earns 1000 pts for every event × class group", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    // Directly: Alex wins every C1 event → all his scores are 1000
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    for (const score of alex.scores) {
      expect(score.points).toBe(1000);
    }
    // Cam wins all CS events she scored (events 1-3)
    const cs = standings.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    for (const score of cam.scores) {
      expect(score.points).toBe(1000);
    }
    // No score can exceed 1000
    for (const section of standings) {
      for (const driver of section.drivers) {
        for (const score of driver.scores) {
          expect(score.points).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  // Assertion 2: Fractional scoring math.
  // Event 1 / C1: fastest=50000ms (Alex), Bea=55000ms → round(1000*50000/55000) = 909
  it("fractional scoring: Bea at event 1 earns 909 pts", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const bea = c1.drivers.find((d) => d.driverName === "Bea B.")!;
    // Event 1 is the first event chronologically
    const event1Score = bea.scores.find((s) => s.eventName === "Season Event 1");
    expect(event1Score).toBeDefined();
    expect(event1Score!.points).toBe(Math.round((1000 * 50000) / 55000)); // 909
  });

  // Assertion 3: Best-4-of-N — Alex has 5 events, exactly 4 counted, 1 dropped.
  it("best-4-of-N: Alex has 4 counted and 1 dropped score", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    expect(alex.scores).toHaveLength(5);
    const counted = alex.scores.filter((s) => !s.dropped);
    const dropped = alex.scores.filter((s) => s.dropped);
    expect(counted).toHaveLength(4);
    expect(dropped).toHaveLength(1);
    const sumCounted = counted.reduce((acc, s) => acc + s.points, 0);
    expect(alex.totalPoints).toBe(sumCounted);
    // All Alex's scores are 1000, so totalPoints = 4000
    expect(alex.totalPoints).toBe(4000);
  });

  // Assertion 4: Off-class entries excluded.
  // Bea's CS entry at event 5 must NOT appear in her scores.
  it("off-class entries excluded: Bea's CS event 5 not in her scores", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const bea = c1.drivers.find((d) => d.driverName === "Bea B.")!;
    // Bea entered C1 at events 1-4 and CS at event 5.  Season class = C1.
    // So she should have exactly 4 scores (events 1-4 in C1).
    expect(bea.scores).toHaveLength(4);
    // Event 5 must not appear
    expect(bea.scores.find((s) => s.eventName === "Season Event 5")).toBeUndefined();
    // Total = 909 + 962 + 963 + 930 = 3764
    expect(bea.totalPoints).toBe(
      Math.round((1000 * 50000) / 55000) +  // event 1: 909
      Math.round((1000 * 51000) / 53000) +  // event 2: 962
      Math.round((1000 * 52000) / 54000) +  // event 3: 963
      Math.round((1000 * 53000) / 57000),   // event 4: 930
    );
  });

  // Bea's off-class CS entry at event 5 must also NOT appear in CS standings.
  it("off-class entries excluded: Bea's entry not in CS standings", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const cs = standings.find((s) => s.classCode === "CS")!;
    const beaInCS = cs.drivers.find((d) => d.driverName === "Bea B.");
    expect(beaInCS).toBeUndefined();
  });

  // Assertion 5: Season class tiebreak.
  // Dee: 2 entries in C1 (events 1+2), 2 entries in CS (events 3+4).
  // C1 and CS tie at 2; C1 wins because event 1 < event 3.
  it("season class tiebreak: Dee (2 C1 + 2 CS) lands in C1 (earliest event wins)", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const dee = c1.drivers.find((d) => d.driverName === "Dee D.");
    expect(dee).toBeDefined();
    // Dee's C1 scores: event 1 = 833, event 2 = 911  → total = 1744
    expect(dee!.scores).toHaveLength(2);
    expect(dee!.totalPoints).toBe(
      Math.round((1000 * 50000) / 60000) + Math.round((1000 * 51000) / 56000),
    ); // 833 + 911 = 1744
    // Dee must NOT appear in CS standings
    const cs = standings.find((s) => s.classCode === "CS")!;
    expect(cs.drivers.find((d) => d.driverName === "Dee D.")).toBeUndefined();
  });

  // Assertion 6: Eligibility flag.
  it("eligibility: Cam (3 CS events) is Provisional; Alex (5 events) is eligible", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const cs = standings.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    expect(cam.eligible).toBe(false);
    expect(cam.eventsCountedInClass).toBe(3);

    const c1 = standings.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    expect(alex.eligible).toBe(true);
    expect(alex.eventsCountedInClass).toBe(5);
  });

  it("eligibility: Evan (1 C1 event) is Provisional", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const c1 = standings.find((s) => s.classCode === "C1")!;
    const evan = c1.drivers.find((d) => d.driverName === "Evan E.")!;
    expect(evan.eligible).toBe(false);
    expect(evan.eventsCountedInClass).toBe(1);
    expect(evan.totalPoints).toBe(Math.round((1000 * 50000) / 62000)); // 806
  });

  // Cam's DNF at event 5 must not contribute a score (CLEAN filter).
  it("CLEAN filter: Cam's DNF at event 5 produces no score entry", async () => {
    const standings = await buildSeasonLeaderboard(2026, prisma);
    const cs = standings.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    // Events 1, 2, 3 scored; event 5 DNF → no score for event 5
    expect(cam.scores).toHaveLength(3);
    expect(cam.scores.find((s) => s.eventName === "Season Event 5")).toBeUndefined();
    expect(cam.totalPoints).toBe(3000);
  });

  // Assertion: bestCommittedRunNumber is honored at ingest and at best-time computation.
  // Event 3: Cam has two runs — R1=59000ms (bestCommittedRunNumber=1), R2=57000ms (faster clean).
  // bestCorrectedMsForEntry must return 59000ms (committed), not 57000ms (unconstrained fastest).
  it("honors bestCommittedRunNumber: Cam event 3 uses committed R1 (59000ms), not faster R2 (57000ms)", async () => {
    const event3 = await prisma.event.findFirst({
      where: { name: "Season Event 3" },
      include: {
        entries: {
          where: { driverId: camId },
          include: {
            runs: { select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true } },
          },
        },
      },
    });
    expect(event3).not.toBeNull();
    const camEntry = event3!.entries[0];
    expect(camEntry).toBeDefined();
    // Fixture sets bestCommittedRunNumber=1 (R1=59000ms)
    expect(camEntry!.bestCommittedRunNumber).toBe(1);
    // Cam has 2 runs: R1=59000ms, R2=57000ms
    expect(camEntry!.runs).toHaveLength(2);
    // bestCorrectedMsForEntry honors the committed pointer → 59000ms
    const best = bestCorrectedMsForEntry(camEntry!);
    expect(best).toBe(59000);
    // Without the override the fastest clean would be 57000ms (R2)
    const r2 = camEntry!.runs.find((r) => r.runNumber === 2);
    expect(r2!.rawTimeMs).toBe(57000);
  });
});

// ---------------------------------------------------------------------------
// Assertion 7: listSeasonYears
// ---------------------------------------------------------------------------
describe("listSeasonYears", () => {
  it("returns [2026] in descending order with this fixture", async () => {
    const years = await listSeasonYears(prisma);
    expect(years).toEqual([2026]);
  });

  it("returns distinct years, sorted desc", async () => {
    const years = await listSeasonYears(prisma);
    // Should be sorted descending and unique
    for (let i = 1; i < years.length; i++) {
      expect(years[i]!).toBeLessThan(years[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// Assertion 8: Empty year returns empty array
// ---------------------------------------------------------------------------
describe("buildSeasonLeaderboard empty year", () => {
  it("returns [] for a year with no events", async () => {
    const standings = await buildSeasonLeaderboard(1999, prisma);
    expect(standings).toEqual([]);
  });
});
