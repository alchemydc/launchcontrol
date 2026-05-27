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
  "season-event-6.axdb",
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

  // Ingest all 6 season events into the test DB.
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
//  Alex  (C1, 6 events)  → 1000 × 6, best 4 = 4000, 2 dropped
//  Bea   (C1, 5 events + CS event 5 off-class) → 963+962+948+930 = 3803 (top-4 of 5; 909 dropped)
//  Cam   (CS, 3 scoring events + DNF at events 5+6) → 1000 × 3 = 3000, eligible=false
//  Dee   (2 C1 + 2 CS → tiebreak C1) → 833 + 911 = 1744
//  Evan  (C1, 1 event)  → 806, eligible=false
//  Fred  (CS, primary=Boxster S 5 events, event 3 Cayman GT4 excluded) → top-4 of 5 = 3921
//  Gina  (CS, primary=911 3 events by cumulative-points tiebreak) → 983×3 = 2949, eligible=false
//
// Dynamic qualifying threshold: floor(6/2)+1 = 4
// ---------------------------------------------------------------------------

describe("buildSeasonLeaderboard(2026)", () => {
  it("returns C1 and CS sections only", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const codes = result.sections.map((s) => s.classCode).sort();
    expect(codes).toEqual(["C1", "CS"]);
  });

  it("class C1 is sorted: Alex first (most points), then Bea, Dee, Evan", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1");
    expect(c1).toBeDefined();
    const names = c1!.drivers.map((d) => d.driverName);
    // Alex: 4000, Bea: 3803, Dee: 1744, Evan: 806
    expect(names[0]).toBe("Alex A.");
    expect(names[1]).toBe("Bea B.");
    expect(names[2]).toBe("Dee D.");
    expect(names[3]).toBe("Evan E.");
  });

  // Assertion 1: Fastest driver in class = 1000 pts for every (event, class) group.
  it("fastest in class earns 1000 pts for every event × class group", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    // Directly: Alex wins every C1 event → all his scores are 1000
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    for (const score of alex.scores) {
      expect(score.points).toBe(1000);
    }
    // Cam wins all CS events she scored (events 1-3)
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    for (const score of cam.scores) {
      expect(score.points).toBe(1000);
    }
    // No score can exceed 1000
    for (const section of result.sections) {
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
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const bea = c1.drivers.find((d) => d.driverName === "Bea B.")!;
    // Event 1 is the first event chronologically
    const event1Score = bea.scores.find((s) => s.eventName === "Season Event 1");
    expect(event1Score).toBeDefined();
    expect(event1Score!.points).toBe(Math.round((1000 * 50000) / 55000)); // 909
  });

  // Assertion 3: Best-4-of-N — Alex has 6 events, exactly 4 counted, 2 dropped.
  it("best-4-of-N: Alex has 4 counted and 2 dropped scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    expect(alex.scores).toHaveLength(6);
    const counted = alex.scores.filter((s) => !s.dropped);
    const dropped = alex.scores.filter((s) => s.dropped);
    expect(counted).toHaveLength(4);
    expect(dropped).toHaveLength(2);
    const sumCounted = counted.reduce((acc, s) => acc + s.points, 0);
    expect(alex.totalPoints).toBe(sumCounted);
    // All Alex's scores are 1000, so totalPoints = 4000
    expect(alex.totalPoints).toBe(4000);
  });

  // Assertion 4: Off-class entries excluded.
  // Bea's CS entry at event 5 must NOT appear in her scores.
  it("off-class entries excluded: Bea's CS event 5 not in her scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const bea = c1.drivers.find((d) => d.driverName === "Bea B.")!;
    // Bea entered C1 at events 1-4+6 and CS at event 5.  Season class = C1 (5 entries).
    // So she should have exactly 5 scores (events 1-4+6 in C1).
    expect(bea.scores).toHaveLength(5);
    // Event 5 must not appear
    expect(bea.scores.find((s) => s.eventName === "Season Event 5")).toBeUndefined();
    // Top-4 of 5: 963 + 962 + 948 + 930 = 3803 (event 1 score 909 dropped)
    expect(bea.totalPoints).toBe(
      Math.round((1000 * 52000) / 54000) +  // event 3: 963
      Math.round((1000 * 51000) / 53000) +  // event 2: 962
      Math.round((1000 * 55000) / 58000) +  // event 6: 948
      Math.round((1000 * 53000) / 57000),   // event 4: 930
    );
  });

  // Bea's off-class CS entry at event 5 must also NOT appear in CS standings.
  it("off-class entries excluded: Bea's entry not in CS standings", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const beaInCS = cs.drivers.find((d) => d.driverName === "Bea B.");
    expect(beaInCS).toBeUndefined();
  });

  // Assertion 5: Season class tiebreak.
  // Dee: 2 entries in C1 (events 1+2), 2 entries in CS (events 3+4).
  // C1 and CS tie at 2; C1 wins because event 1 < event 3.
  it("season class tiebreak: Dee (2 C1 + 2 CS) lands in C1 (earliest event wins)", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const dee = c1.drivers.find((d) => d.driverName === "Dee D.");
    expect(dee).toBeDefined();
    // Dee's C1 scores: event 1 = 833, event 2 = 911  → total = 1744
    expect(dee!.scores).toHaveLength(2);
    expect(dee!.totalPoints).toBe(
      Math.round((1000 * 50000) / 60000) + Math.round((1000 * 51000) / 56000),
    ); // 833 + 911 = 1744
    // Dee must NOT appear in CS standings
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    expect(cs.drivers.find((d) => d.driverName === "Dee D.")).toBeUndefined();
  });

  // Assertion 6: Eligibility flag.
  it("eligibility: Cam (3 CS events) is Provisional; Alex (6 events) is eligible", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    expect(cam.eligible).toBe(false);
    expect(cam.eventsCountedInClass).toBe(3);

    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    expect(alex.eligible).toBe(true);
    expect(alex.eventsCountedInClass).toBe(6);
  });

  it("eligibility: Evan (1 C1 event) is Provisional", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const evan = c1.drivers.find((d) => d.driverName === "Evan E.")!;
    expect(evan.eligible).toBe(false);
    expect(evan.eventsCountedInClass).toBe(1);
    expect(evan.totalPoints).toBe(Math.round((1000 * 50000) / 62000)); // 806
  });

  // Cam's DNF at events 5 and 6 must not contribute scores (CLEAN filter).
  it("CLEAN filter: Cam's DNF at events 5 and 6 produce no score entries", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    // Events 1, 2, 3 scored; events 5+6 DNF → 3 scores total
    expect(cam.scores).toHaveLength(3);
    expect(cam.scores.find((s) => s.eventName === "Season Event 5")).toBeUndefined();
    expect(cam.scores.find((s) => s.eventName === "Season Event 6")).toBeUndefined();
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

  // ---------------------------------------------------------------------------
  // M1.13 — Top-level metadata
  // ---------------------------------------------------------------------------

  it("result.totalEvents is 6 and result.qualifyingEvents is 4", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    expect(result.totalEvents).toBe(6);
    expect(result.qualifyingEvents).toBe(4);
  });

  it("per-row qualifyingEvents matches season-level qualifyingEvents", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    expect(alex.qualifyingEvents).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // M1.13 — Single-car constraint: Fred (primary = Boxster S, 5 events)
  // ---------------------------------------------------------------------------

  it("Fred's primary car is Boxster S", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    expect(fred).toBeDefined();
    expect(fred.primaryCar?.carDescription).toBe("Boxster S");
  });

  it("Fred has 5 counted scores (Cayman GT4 event 3 excluded by single-car constraint)", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    // Fred has 5 primary-car entries (events 1,2,4,5,6); event 3 (Cayman GT4) excluded
    expect(fred.scores).toHaveLength(5);
    // Event 3 must not appear in Fred's scores
    expect(fred.scores.find((s) => s.eventName === "Season Event 3")).toBeUndefined();
  });

  it("Fred's totalPoints uses best-4 of his 5 primary-car scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    // Scores (primary-car only): event1=919, event2=921, event4=954, event5=909, event6=1000
    // Fastest at event 4 CS is Dee (62000ms), so Fred gets round(62000/65000*1000)=954.
    // Fastest at event 5 CS is Bea (60000ms, off-class but still counted for scoring),
    //   so Fred gets round(60000/66000*1000)=909.
    // Top-4: 1000+954+921+919=3794 (event5=909 dropped)
    const event1Pts = Math.round((1000 * 57000) / 62000); // 919
    const event2Pts = Math.round((1000 * 58000) / 63000); // 921
    const event4Pts = Math.round((1000 * 62000) / 65000); // 954 — Dee is fastest CS at event 4
    expect(fred.totalPoints).toBe(1000 + event4Pts + event2Pts + event1Pts); // 3794
    // event 5 score (909) is dropped
    const event5Score = fred.scores.find((s) => s.eventName === "Season Event 5");
    expect(event5Score).toBeDefined();
    expect(event5Score!.dropped).toBe(true);
  });

  it("normalization: Fred's lowercased 'boxster s' entry (event 1) is included in his scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    // Event 1 uses car_model="boxster s" which normalizes to same carKey as "Boxster S" (events 2,4,5,6)
    // → Fred's event 1 score is included in his primary-car scores, not excluded.
    const event1Score = fred.scores.find((s) => s.eventName === "Season Event 1");
    expect(event1Score).toBeDefined();
    const event1Pts = Math.round((1000 * 57000) / 62000); // 919
    expect(event1Score!.points).toBe(event1Pts);
  });

  // ---------------------------------------------------------------------------
  // M1.13 — Single-car constraint: Gina (primary = 911, by cumulative-points tiebreak)
  // ---------------------------------------------------------------------------

  it("Gina's primary car is 911 (count tie, 911 wins on cumulative points)", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const gina = cs.drivers.find((d) => d.driverName === "Gina G.")!;
    expect(gina).toBeDefined();
    expect(gina.primaryCar?.carDescription).toBe("911");
  });

  it("Gina has 3 scores (only 911 events; Cayman events excluded) and is Provisional", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const gina = cs.drivers.find((d) => d.driverName === "Gina G.")!;
    // Only 911 events (1,2,3) count; Cayman events (4,5,6) excluded
    expect(gina.scores).toHaveLength(3);
    // Gina has 3 scoring events < 4 threshold → Provisional
    expect(gina.eligible).toBe(false);
    expect(gina.eventsCountedInClass).toBe(3);
  });

  it("Gina's totalPoints = 983 × 3 = 2949 from her 911 events", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const gina = cs.drivers.find((d) => d.driverName === "Gina G.")!;
    // Event 1: round(1000*57000/58000)=983, Event 2: round(1000*58000/59000)=983, Event 3: round(1000*59000/60000)=983
    const e1 = Math.round((1000 * 57000) / 58000);
    const e2 = Math.round((1000 * 58000) / 59000);
    const e3 = Math.round((1000 * 59000) / 60000);
    expect(gina.totalPoints).toBe(e1 + e2 + e3);
  });
});

// ---------------------------------------------------------------------------
// M1.13 — qualifyingEventCount helper unit tests
// ---------------------------------------------------------------------------
describe("qualifyingEventCount formula", () => {
  // Tested indirectly via result.qualifyingEvents for known N values.
  // We exercise the formula through the public API with different event counts.
  // The fixture has 6 events → floor(6/2)+1 = 4.
  it("6 events → qualifyingEvents = 4", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    expect(result.totalEvents).toBe(6);
    expect(result.qualifyingEvents).toBe(4);
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
// Assertion 8: Empty year returns empty result
// ---------------------------------------------------------------------------
describe("buildSeasonLeaderboard empty year", () => {
  it("returns empty sections for a year with no events", async () => {
    const result = await buildSeasonLeaderboard(1999, prisma);
    expect(result.sections).toEqual([]);
    expect(result.totalEvents).toBe(0);
    expect(result.qualifyingEvents).toBe(0);
  });
});
