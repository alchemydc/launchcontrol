import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";
import { buildSeasonLeaderboard, combinedEventLabel } from "@/lib/season-leaderboard";
import { buildCombinedResults } from "@/lib/combined-event";
import { ensureLeagueAndSeasons } from "./helpers/league-fixture";

const TEST_DB_PATH = resolve(__dirname, "..", "test-combined-event.db");
const TEST_DB_URL = "file:./test-combined-event.db";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
// Ingest chronologically, matching the standing operational convention.
const SEASON_FILES = [
  "combined-event-1-opener.axdb",
  "combined-event-2-classic.axdb",
  "combined-event-3a.axdb",
  "combined-event-3b.axdb",
];

let prisma: PrismaClient;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  for (const filename of SEASON_FILES) {
    const path = resolve(FIXTURES_DIR, filename);
    await ingestAxdb(path, prisma);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

// ---------------------------------------------------------------------------
// combinedEventLabel — pure unit tests (documented in
// tests/fixtures/build-combined-event-season.mjs)
// ---------------------------------------------------------------------------

describe("combinedEventLabel", () => {
  it("strips a trailing parenthesized session token when all sessions agree", () => {
    const label = combinedEventLabel([
      { id: 1, name: "Cone in 60 Seconds (A)" },
      { id: 2, name: "Cone in 60 Seconds (B)" },
    ]);
    expect(label).toBe("Cone in 60 Seconds");
  });

  it("falls back to the lowest-id session's full name when stripped names disagree", () => {
    const label = combinedEventLabel([
      { id: 2, name: "Afternoon Session (B)" },
      { id: 1, name: "Morning Session (A)" },
    ]);
    expect(label).toBe("Morning Session (A)");
  });

  it("returns the (single) event's own name unchanged in shape for a one-element input", () => {
    const label = combinedEventLabel([{ id: 1, name: "Solo Event" }]);
    expect(label).toBe("Solo Event");
  });

  it("returns empty string for an empty input", () => {
    expect(combinedEventLabel([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildSeasonLeaderboard(2027) — scoring-group grouping + combined scoring
// ---------------------------------------------------------------------------

describe("buildSeasonLeaderboard(2027) — combined-event scoring groups", () => {
  it("totalEvents is 3 scoring groups (2 normal + 1 combined pair) and qualifyingEvents is 2", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    expect(result.totalEvents).toBe(3);
    expect(result.qualifyingEvents).toBe(2);
    // The 2027 Season row is auto-created by ingestAxdb with plannedEvents=0,
    // so this is a pure fallback-to-actual regression case (M1.16):
    // completedEvents === totalEvents === actual scoring groups. Must run
    // before the "planned-season override" describe block below, which
    // mutates this Season row's plannedEvents.
    expect(result.completedEvents).toBe(3);
  });

  it("Quinn's C1 row: opener + classic (1000 each) count, combined (943) drops", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const quinn = c1.drivers.find((d) => d.driverName === "Quinn Q.")!;
    expect(quinn.scores).toHaveLength(3);
    expect(quinn.eligible).toBe(true);
    expect(quinn.eventsCountedInClass).toBe(3);
    expect(quinn.totalPoints).toBe(2000);

    const combinedScore = quinn.scores.find((s) => s.combined);
    expect(combinedScore).toBeDefined();
    expect(combinedScore!.points).toBe(Math.round((1000 * 83000) / 88000)); // 943
    expect(combinedScore!.dropped).toBe(true);
    expect(combinedScore!.eventName).toBe("Cone in 60 Seconds");
    expect(combinedScore!.href).toBe("/events/combined/2027-05-15");

    const singleScores = quinn.scores.filter((s) => !s.combined);
    expect(singleScores).toHaveLength(2);
    for (const s of singleScores) {
      expect(s.points).toBe(1000);
      expect(s.dropped).toBe(false);
      expect(s.href).toMatch(/^\/events\//);
    }
  });

  it("Rae's C1 row: combined (965) + opener (962) count, classic (941) drops", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const rae = c1.drivers.find((d) => d.driverName === "Rae R.")!;
    expect(rae.scores).toHaveLength(3);
    expect(rae.eligible).toBe(true);

    const combinedScore = rae.scores.find((s) => s.combined)!;
    expect(combinedScore.points).toBe(Math.round((1000 * 83000) / 86000)); // 965
    expect(combinedScore.dropped).toBe(false);

    const classicScore = rae.scores.find((s) => s.eventName === "Summer Classic")!;
    expect(classicScore.points).toBe(Math.round((1000 * 48000) / 51000)); // 941
    expect(classicScore.dropped).toBe(true);

    expect(rae.totalPoints).toBe(
      Math.round((1000 * 83000) / 86000) + Math.round((1000 * 50000) / 52000), // combined + opener
    );
  });

  it("Ivy wins the combined C1 group on summed time despite winning neither session, provisional 1/2", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const ivy = c1.drivers.find((d) => d.driverName === "Ivy I.")!;
    expect(ivy.scores).toHaveLength(1);
    expect(ivy.scores[0]!.combined).toBe(true);
    expect(ivy.scores[0]!.points).toBe(1000);
    expect(ivy.scores[0]!.dropped).toBe(false);
    expect(ivy.eligible).toBe(false);
    expect(ivy.eventsCountedInClass).toBe(1);
    expect(ivy.totalPoints).toBe(1000);
  });

  it("CS group: Owen (1000) and Pia (965), both provisional 1/2 (only scoring group they entered)", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    const cs = result.sections.find((s) => s.classCode === "CS")!;
    const owen = cs.drivers.find((d) => d.driverName === "Owen O.")!;
    const pia = cs.drivers.find((d) => d.driverName === "Pia O.")!;
    expect(owen.totalPoints).toBe(1000);
    expect(owen.eligible).toBe(false);
    expect(pia.totalPoints).toBe(Math.round((1000 * 111000) / 115000)); // 965
    expect(pia.eligible).toBe(false);
  });

  it("forfeited drivers (missing session, DNF-only session, class mismatch) earn no season score at all", async () => {
    const result = await buildSeasonLeaderboard(2027, prisma);
    const allNames = result.sections.flatMap((s) => s.drivers.map((d) => d.driverName));
    expect(allNames).not.toContain("Leo L."); // missing session B
    expect(allNames).not.toContain("Mia C."); // DNF in session A
    expect(allNames).not.toContain("Nick D."); // class mismatch A vs. B
  });
});

// ---------------------------------------------------------------------------
// M1.16 — planned-season threshold override. plannedEvents now lives on the
// Season row (League Foundation) rather than an injected map, so these
// mutate the auto-created 2027 Season's plannedEvents directly (ingestAxdb's
// beforeAll auto-create left it at 0) to exercise the same two branches of
// max(planned, actual) against this existing 3-group fixture without
// regenerating it.
// ---------------------------------------------------------------------------

describe("buildSeasonLeaderboard(2027) — planned-season override via Season row", () => {
  it("planned=6 > actual=3: totalEvents=6, qualifyingEvents=4, every driver Provisional, nothing dropped", async () => {
    await prisma.season.updateMany({ where: { year: 2027 }, data: { plannedEvents: 6 } });
    const result = await buildSeasonLeaderboard(2027, prisma);
    expect(result.totalEvents).toBe(6);
    expect(result.completedEvents).toBe(3);
    expect(result.qualifyingEvents).toBe(4);

    for (const section of result.sections) {
      for (const driver of section.drivers) {
        expect(driver.qualifyingEvents).toBe(4);
        expect(driver.eligible).toBe(false);
        for (const score of driver.scores) {
          expect(score.dropped).toBe(false);
        }
      }
    }

    // Quinn's combined score (943 pts) was dropped under the derived
    // threshold of 2 (best-2-of-3); with threshold 4 all 3 of her scores
    // count, raising her total from 2000 to 2943.
    const c1 = result.sections.find((s) => s.classCode === "C1")!;
    const quinn = c1.drivers.find((d) => d.driverName === "Quinn Q.")!;
    const combinedScore = quinn.scores.find((s) => s.combined)!;
    expect(combinedScore.dropped).toBe(false);
    expect(quinn.totalPoints).toBe(2000 + combinedScore.points);
  });

  it("planned=2 < actual=3: max(2,3)=3, identical to the actual-only (plannedEvents=0) run", async () => {
    await prisma.season.updateMany({ where: { year: 2027 }, data: { plannedEvents: 2 } });
    const withPlanned2 = await buildSeasonLeaderboard(2027, prisma);

    await prisma.season.updateMany({ where: { year: 2027 }, data: { plannedEvents: 0 } });
    const withPlanned0 = await buildSeasonLeaderboard(2027, prisma);

    expect(withPlanned2).toEqual(withPlanned0);
    expect(withPlanned2.totalEvents).toBe(3);
    expect(withPlanned2.qualifyingEvents).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildCombinedResults — session-level combined page assertions
// ---------------------------------------------------------------------------

describe("buildCombinedResults", () => {
  async function loadGroup3() {
    const events = await prisma.event.findMany({
      where: { date: new Date("2027-05-15T00:00:00.000Z") },
      orderBy: { id: "asc" },
      include: { entries: { include: { driver: true, class: true, runs: true } } },
    });
    expect(events).toHaveLength(2);
    return events;
  }

  it("label is the shared stripped name, sessions ordered A before B", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    expect(results.label).toBe("Cone in 60 Seconds");
    expect(results.sessions).toHaveLength(2);
    expect(results.sessions[0]!.name).toBe("Cone in 60 Seconds (A)");
    expect(results.sessions[1]!.name).toBe("Cone in 60 Seconds (B)");
  });

  it("C1 ranked order is Ivy, Rae, Quinn (by Time Sum ascending)", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    const c1 = results.classes.find((c) => c.classCode === "C1")!;
    expect(c1.ranked.map((r) => r.driverName)).toEqual(["Ivy I.", "Rae R.", "Quinn Q."]);
    expect(c1.ranked.map((r) => r.sumMs)).toEqual([83000, 86000, 88000]);
  });

  it("C1 unranked lists Leo (missing B), Mia (missing A), Nick (missing B), sorted by name", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    const c1 = results.classes.find((c) => c.classCode === "C1")!;
    expect(c1.unranked.map((r) => r.driverName)).toEqual(["Leo L.", "Mia C.", "Nick D."]);

    const leo = c1.unranked.find((r) => r.driverName === "Leo L.")!;
    expect(leo.missingSessions).toEqual(["Cone in 60 Seconds (B)"]);
    expect(leo.sumMs).toBeNull();

    const mia = c1.unranked.find((r) => r.driverName === "Mia C.")!;
    expect(mia.missingSessions).toEqual(["Cone in 60 Seconds (A)"]);

    const nick = c1.unranked.find((r) => r.driverName === "Nick D.")!;
    expect(nick.missingSessions).toEqual(["Cone in 60 Seconds (B)"]);
  });

  it("CS ranked order is Owen then Pia; Nick appears unranked (missing A)", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    const cs = results.classes.find((c) => c.classCode === "CS")!;
    expect(cs.ranked.map((r) => r.driverName)).toEqual(["Owen O.", "Pia O."]);
    expect(cs.ranked.map((r) => r.sumMs)).toEqual([111000, 115000]);
    expect(cs.unranked.map((r) => r.driverName)).toEqual(["Nick D."]);
    expect(cs.unranked[0]!.missingSessions).toEqual(["Cone in 60 Seconds (A)"]);
  });

  it("co-drive pair (Owen #62 / Pia #162) both score independently in CS", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    const cs = results.classes.find((c) => c.classCode === "CS")!;
    const owen = cs.ranked.find((r) => r.driverName === "Owen O.")!;
    const pia = cs.ranked.find((r) => r.driverName === "Pia O.")!;
    expect(owen.carNumber).toBe("62");
    expect(pia.carNumber).toBe("162");
  });

  it("overall section ranks across classes by Time Sum and flags Nick's class mismatch", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    expect(results.overall.ranked.map((r) => r.driverName)).toEqual([
      "Ivy I.",
      "Rae R.",
      "Quinn Q.",
      "Owen O.",
      "Pia O.",
    ]);

    const nick = results.overall.unranked.find((r) => r.driverName === "Nick D.")!;
    expect(nick).toBeDefined();
    expect(nick.classMismatch).toBe(true);
    expect(nick.missingSessions).toEqual([]); // he raced both sessions — just in different classes

    const leo = results.overall.unranked.find((r) => r.driverName === "Leo L.")!;
    expect(leo.classMismatch).toBe(false);
    expect(leo.missingSessions).toEqual(["Cone in 60 Seconds (B)"]);
  });

  it("per-session run number is surfaced alongside the corrected time", async () => {
    const events = await loadGroup3();
    const results = buildCombinedResults(events);
    const c1 = results.classes.find((c) => c.classCode === "C1")!;
    const ivy = c1.ranked.find((r) => r.driverName === "Ivy I.")!;
    for (const session of ivy.sessions) {
      expect(session.runNumber).toBe(1); // single-run drivers in this fixture
      expect(session.correctedMs).not.toBeNull();
    }
  });
});
