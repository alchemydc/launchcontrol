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

describe("member_num normalization across events", () => {
  it("collapses Fred's 'verified'-suffixed raw member_num forms to one Driver row", async () => {
    // Fred's raw member_num is "MES-006 verified" at event 1 and "MES-006-verified"
    // at event 2, but plain "MES-006" at events 3-6. normalizeMemberNum() must
    // strip both suffix forms so all 6 events resolve to the same Driver.
    const freds = await prisma.driver.findMany({ where: { firstName: "Fred" } });
    expect(freds).toHaveLength(1);
    expect(freds[0]!.memberNum).toBe("MES-006");
  });
});

describe("nameOnlyHash merge-back across events", () => {
  it("collapses Gina's blank-member_num event (event 4) into her one populated Driver row", async () => {
    // Gina's member_num is "MES-007" at events 1-3, 5-6, but blank at event 4.
    // The blank row must merge into the existing populated Driver by nameOnlyHash
    // rather than splitting into a second Driver — ingest.test.ts covers the
    // merge/adopt mechanism directly; this checks it holds across a full season.
    const ginas = await prisma.driver.findMany({ where: { firstName: "Gina", lastInitial: "G." } });
    expect(ginas).toHaveLength(1);
    expect(ginas[0]!.memberNum).toBe("MES-007");
  });
});

// ---------------------------------------------------------------------------
// Fixture overview (documented in build-multi-event-season.mjs):
//
// Multi-class / multi-car (M1.14): a driver appears in every class they
// entered; multiple cars within the same class all count for points.
//
//  C1:
//    Alex  1000×6                      → top-4 = 4000 eligible
//    Bea   909, 962, 963, 930, 948     → top-4 = 3803 eligible (909 dropped)
//    Dee   833, 911                    → 1744 provisional 2/4
//    Evan  806                         → 806 provisional 1/4
//
//  CS:
//    Fred  919, 921, 922, 954, 909, 1000 → top-4 = 3797 eligible (909+919 dropped)
//    Gina  983, 983, 983, 775, 741, 817  → top-4 = 3766 eligible (775+741 dropped)
//    Cam   1000, 1000, 1000              → 3000 provisional 3/4 (DNF at 5+6)
//    Dee   967, 1000                     → 1967 provisional 2/4
//    Bea   1000                          → 1000 provisional 1/4 (event 5 only)
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
    // Alex wins every C1 event → all his scores are 1000.
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const alex = c1.drivers.find((d) => d.driverName === "Alex A.")!;
    for (const score of alex.scores) {
      expect(score.points).toBe(1000);
    }
    // Cam wins each CS event she scored (events 1-3, both DNF at 5+6).
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const cam = cs.drivers.find((d) => d.driverName === "Cam C.")!;
    for (const score of cam.scores) {
      expect(score.points).toBe(1000);
    }
    // No score can exceed 1000.
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

  // Assertion 4 (M1.14): Multi-class participation. Bea ran C1 at events 1-4+6
  // and CS at event 5. Her C1 row reflects 5 scoring events; her CS row reflects 1.
  it("multi-class: Bea's C1 row has 5 scores (event 5 is CS-only, not in C1)", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const bea = c1.drivers.find((d) => d.driverName === "Bea B.")!;
    expect(bea.scores).toHaveLength(5);
    expect(bea.scores.find((s) => s.eventName === "Season Event 5")).toBeUndefined();
    // Top-4 of 5: 963 + 962 + 948 + 930 = 3803 (event 1 score 909 dropped)
    expect(bea.totalPoints).toBe(
      Math.round((1000 * 52000) / 54000) +  // event 3: 963
      Math.round((1000 * 51000) / 53000) +  // event 2: 962
      Math.round((1000 * 55000) / 58000) +  // event 6: 948
      Math.round((1000 * 53000) / 57000),   // event 4: 930
    );
    expect(bea.eligible).toBe(true);
  });

  it("multi-class: Bea also appears in CS standings as Provisional 1/4", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const bea = cs.drivers.find((d) => d.driverName === "Bea B.");
    expect(bea).toBeDefined();
    expect(bea!.scores).toHaveLength(1);
    // At event 5 CS Bea (60000ms) is the fastest entry → 1000 pts.
    expect(bea!.scores[0]!.eventName).toBe("Season Event 5");
    expect(bea!.scores[0]!.points).toBe(1000);
    expect(bea!.totalPoints).toBe(1000);
    expect(bea!.eligible).toBe(false);
    expect(bea!.eventsCountedInClass).toBe(1);
  });

  // Assertion 5 (M1.14): Dee ran C1 events 1-2 and CS events 3-4. She appears
  // in both class sections, Provisional in each (2/4).
  it("multi-class: Dee appears in C1 (2 scores) and CS (2 scores), both Provisional", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const deeC1 = c1.drivers.find((d) => d.driverName === "Dee D.")!;
    expect(deeC1).toBeDefined();
    expect(deeC1.scores).toHaveLength(2);
    // C1: event 1 = 833, event 2 = 911 → 1744
    expect(deeC1.totalPoints).toBe(
      Math.round((1000 * 50000) / 60000) + Math.round((1000 * 51000) / 56000),
    );
    expect(deeC1.eligible).toBe(false);
    expect(deeC1.eventsCountedInClass).toBe(2);

    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const deeCS = cs.drivers.find((d) => d.driverName === "Dee D.")!;
    expect(deeCS).toBeDefined();
    expect(deeCS.scores).toHaveLength(2);
    // CS: event 3 = round(59000/61000*1000)=967, event 4 = 1000 (Dee wins) → 1967
    expect(deeCS.totalPoints).toBe(Math.round((1000 * 59000) / 61000) + 1000);
    expect(deeCS.eligible).toBe(false);
    expect(deeCS.eventsCountedInClass).toBe(2);
    // Same driverId in both sections, so /drivers/[id] links collapse correctly.
    expect(deeCS.driverId).toBe(deeC1.driverId);
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
  // M1.14 — Multi-car within a class: Fred runs Boxster S (5 events) and
  //         Cayman GT4 (event 3) in CS. All 6 events score for him.
  // ---------------------------------------------------------------------------

  it("multi-car: Fred has 6 CS scores spanning Boxster S and Cayman GT4", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    expect(fred).toBeDefined();
    expect(fred.scores).toHaveLength(6);
    // Event 3 (Cayman GT4) must now appear — no longer filtered out.
    const event3 = fred.scores.find((s) => s.eventName === "Season Event 3");
    expect(event3).toBeDefined();
    // Event 3 / CS fastest = 59000ms (Cam committed) → Fred 64000ms = round(59/64*1000) = 922
    expect(event3!.points).toBe(Math.round((1000 * 59000) / 64000));
  });

  it("multi-car: Fred's totalPoints uses top-4 of all 6 CS scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    // Per-event scores:
    //   e1=919, e2=921, e3=922, e4=954 (Dee wins), e5=909 (Bea wins), e6=1000 (Fred wins, Cam DNF)
    // Top-4 desc: 1000 + 954 + 922 + 921 = 3797 (909 + 919 dropped).
    const e1 = Math.round((1000 * 57000) / 62000); // 919
    const e2 = Math.round((1000 * 58000) / 63000); // 921
    const e3 = Math.round((1000 * 59000) / 64000); // 922
    const e4 = Math.round((1000 * 62000) / 65000); // 954
    expect(fred.totalPoints).toBe(1000 + e4 + e3 + e2);
    expect(fred.totalPoints).toBe(3797);
    expect(fred.eligible).toBe(true);
    expect(fred.eventsCountedInClass).toBe(6);
    // Lower two scores are dropped.
    const event1 = fred.scores.find((s) => s.eventName === "Season Event 1");
    const event5 = fred.scores.find((s) => s.eventName === "Season Event 5");
    expect(event1!.points).toBe(e1);
    expect(event1!.dropped).toBe(true);  // 919 is among the bottom two
    expect(event5!.dropped).toBe(true);  // 909 is among the bottom two
  });

  it("multi-car: car description case ('boxster s' vs 'Boxster S') has no scoring impact", async () => {
    // Pre-M1.14 the lowercased event-1 entry tested normalization of the primary-car
    // grouping. Now there's no grouping — both events simply score on the same axis.
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const fred = cs.drivers.find((d) => d.driverName === "Fred F.")!;
    const event1 = fred.scores.find((s) => s.eventName === "Season Event 1");
    expect(event1).toBeDefined();
    expect(event1!.points).toBe(Math.round((1000 * 57000) / 62000)); // 919
  });

  // ---------------------------------------------------------------------------
  // M1.14 — Multi-car within a class: Gina runs 911 (events 1-3) and Cayman
  //         (events 4-6) in CS. All 6 events score for her.
  // ---------------------------------------------------------------------------

  it("multi-car: Gina has 6 CS scores spanning 911 and Cayman", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const gina = cs.drivers.find((d) => d.driverName === "Gina G.")!;
    expect(gina).toBeDefined();
    expect(gina.scores).toHaveLength(6);
    expect(gina.eligible).toBe(true);
    expect(gina.eventsCountedInClass).toBe(6);
  });

  it("multi-car: Gina's totalPoints = top-4 of all 6 CS scores", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const gina = cs.drivers.find((d) => d.driverName === "Gina G.")!;
    // 911 events score 983 each (Cam is the per-event fastest by a narrow margin).
    // Cayman events: e4 fastest=62000 Dee → 775; e5 fastest=60000 Bea → 741;
    //                e6 fastest=67000 Fred → 817.
    // Top-4: 983 + 983 + 983 + 817 = 3766; 775 and 741 dropped.
    const e1 = Math.round((1000 * 57000) / 58000); // 983
    const e2 = Math.round((1000 * 58000) / 59000); // 983
    const e3 = Math.round((1000 * 59000) / 60000); // 983
    const e6 = Math.round((1000 * 67000) / 82000); // 817
    expect(gina.totalPoints).toBe(e1 + e2 + e3 + e6);
    expect(gina.totalPoints).toBe(3766);
  });

  // ---------------------------------------------------------------------------
  // M1.14 — CS standings ordering reflects multi-class/multi-car results.
  // ---------------------------------------------------------------------------

  it("CS section is sorted: Fred, Gina, Cam, Dee, Bea", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const names = cs.drivers.map((d) => d.driverName);
    // Fred 3797 elig, Gina 3766 elig, Cam 3000 prov, Dee 1967 prov, Bea 1000 prov.
    expect(names).toEqual(["Fred F.", "Gina G.", "Cam C.", "Dee D.", "Bea B."]);
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
