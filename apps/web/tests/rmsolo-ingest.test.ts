import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Ported from archive (feat/rmsolo-ingest @ 12edd82, apps/web/tests/rmsolo-ingest.test.ts),
// adapted to the League model: every ingest here targets the default (pca-rmr) league —
// seeded with a "PCA Classic" ScoringSystem by the league-foundation migration, so
// resolveOrCreateSeason's auto-create path (invoked with no --league) has a preset to
// snapshot, same as ingestAxdb. Class assertions now also pin CarClass.leagueId — see
// tests/rmsolo-ingest-league-targeting.test.ts for cross-league isolation.
//
// Unique per-file DB path (not the shared test.db) so this file's beforeAll
// (rmSync + `prisma migrate deploy`) can't race another test file's DB reset
// when vitest runs test files concurrently — see admin-events.test.ts,
// driver-history.test.ts, combined-event.test.ts, season-leaderboard.test.ts.
const TEST_DB_PATH = resolve(__dirname, "..", "test-rmsolo-ingest.db");
const TEST_DB_URL = "file:./test-rmsolo-ingest.db";

let prisma: PrismaClient;
let leagueId: number;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
  leagueId = league.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

const parsed: ParsedRmsoloEvent = {
  title: "Summer 2026#1",
  classCodes: ["AS"],
  entries: [
    {
      classCode: "AS", position: 1, trophy: true, carNumber: "88", altCarNumber: null,
      firstName: "Alex", lastName: "Driver", carDescription: "2003 Chevrolet Corvette Z06",
      hometown: "Faketown, CO", bestSeconds: 42.298,
      runs: [
        { seconds: 43.969, cones: 0, disposition: "CLEAN" },
        { seconds: 42.908, cones: 1, disposition: "CLEAN" },
        { seconds: 42.298, cones: 0, disposition: "CLEAN" },
      ],
    },
    {
      classCode: "AS", position: 2, trophy: false, carNumber: "44", altCarNumber: "88",
      firstName: "Alexa", lastName: "Driver", carDescription: null, hometown: null,
      bestSeconds: 45.001,
      runs: [
        { seconds: 45.001, cones: 0, disposition: "CLEAN" },
        { seconds: 44.0, cones: 0, disposition: "DNF" },
      ],
    },
  ],
};

describe("ingestRmsoloEvent", () => {
  it("creates event, classes (league-scoped), drivers with redacted initials, entries, runs", async () => {
    const result = await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    expect(result.status).toBe("ingested");
    expect(result.event.slug).toBe("2026-04-18-summer-2026-1");

    const drivers = await prisma.driver.findMany({ orderBy: { id: "asc" } });
    expect(drivers).toHaveLength(2); // same last name, different first → distinct identityHash
    expect(drivers[0]).toMatchObject({ firstName: "Alex", lastInitial: "D." });
    expect(drivers[0]!.memberNum).toBeNull();
    expect(drivers[0]!.nameOnlyHash).not.toBeNull();

    const entries = await prisma.entry.findMany({ include: { runs: true, class: true } });
    expect(entries).toHaveLength(2);
    const alex = entries.find((e) => e.carNumber === "88")!;
    expect(alex.runs).toHaveLength(3);
    expect(alex.runs[1]).toMatchObject({ rawTimeMs: 42908, cones: 1, disposition: "CLEAN" });
    expect(alex.bestCommittedRunNumber).toBe(3); // run 3 = printed Best 42.298
    expect(Number(alex.class.paxIndex)).toBeGreaterThan(0.7); // from RMSOLO_PAX table
    expect(alex.class.leagueId).toBe(leagueId); // CarClass is league-scoped

    // The event's season resolved (auto-created) under the target league, for the event's year.
    const event = await prisma.event.findUniqueOrThrow({ where: { id: alex.eventId } });
    const season = await prisma.season.findUniqueOrThrow({ where: { id: event.seasonId } });
    expect(season.leagueId).toBe(leagueId);
    expect(season.year).toBe(2026);
  });

  it("DNF runs store null rawTimeMs", async () => {
    await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    const dnf = await prisma.run.findFirst({ where: { disposition: "DNF" } });
    expect(dnf!.rawTimeMs).toBeNull();
  });

  it("is idempotent on sha", async () => {
    await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    const again = await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    expect(again.status).toBe("unchanged");
  });

  it("re-ingests (replaces entries) when sha changes for the same slug", async () => {
    await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    const changed = structuredClone(parsed);
    changed.entries[0]!.runs.push({ seconds: 41.0, cones: 0, disposition: "CLEAN" });
    changed.entries[0]!.bestSeconds = 41.0;
    const result = await ingestRmsoloEvent({ parsed: changed, sha256: "def456", date: "2026-04-18" }, prisma);
    expect(result.status).toBe("ingested");
    const drivers = await prisma.driver.findMany();
    expect(drivers).toHaveLength(2); // same identityHash → no duplicate drivers
  });

  it("leaves bestCommittedRunNumber null for unreconciled (e.g. PAX-indexed run-group) entries and warns once", async () => {
    // A third entry whose printed Best (10.0) matches neither raw nor penalized
    // given its own runs — real "M"/"N"/"S"/"P"/"X" run-group headings print a
    // PAX-indexed Best like this (see rmsolo-pax.ts). It must not block the
    // other two entries (which do reconcile) from ingesting normally.
    const withIndexed = structuredClone(parsed);
    withIndexed.classCodes = [...withIndexed.classCodes, "M"];
    withIndexed.entries.push({
      classCode: "M", position: 1, trophy: false, carNumber: "77", altCarNumber: null,
      firstName: "Max", lastName: "Modified", carDescription: null, hometown: null,
      bestSeconds: 10.0,
      runs: [
        { seconds: 20.0, cones: 0, disposition: "CLEAN" },
        { seconds: 19.0, cones: 0, disposition: "CLEAN" },
      ],
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await ingestRmsoloEvent({ parsed: withIndexed, sha256: "unreconciled1", date: "2026-04-18" }, prisma);
    expect(result.status).toBe("ingested");

    // Exactly one warning about the unreconciled entry itself — other warnings
    // (e.g. rmsolo-pax's "no PAX factor for class 'M'", since this synthetic
    // class code has no real-world factor) are unrelated and may also fire.
    const unreconciledWarnings = warnSpy.mock.calls.filter(([msg]) => typeof msg === "string" && msg.includes("could not reconcile"));
    expect(unreconciledWarnings).toHaveLength(1);
    expect(unreconciledWarnings[0]![0]).toMatch(/M\/Max Modified/);
    warnSpy.mockRestore();

    const maxEntry = await prisma.entry.findFirst({ where: { carNumber: "77" } });
    expect(maxEntry!.bestCommittedRunNumber).toBeNull();

    const alexEntry = await prisma.entry.findFirst({ where: { carNumber: "88" } });
    expect(alexEntry!.bestCommittedRunNumber).toBe(3); // unaffected — still reconciles normally
  });

  it("gives distinct blank-name ('anonymous') entries in the same class distinct drivers, keyed by car number", async () => {
    // Real Full PDFs print entries with a car number and a full run set but no
    // name/car description/hometown at all (confirmed against ss1-0418_Full.pdf
    // DS class, cars #33 and #3). Both must ingest as real, distinct results.
    const withAnonymous = structuredClone(parsed);
    withAnonymous.entries.push(
      {
        classCode: "AS", position: 3, trophy: false, carNumber: "33", altCarNumber: null,
        firstName: "", lastName: "", carDescription: null, hometown: null,
        bestSeconds: 45.349,
        runs: [
          { seconds: 47.419, cones: 1, disposition: "CLEAN" },
          { seconds: 45.734, cones: 0, disposition: "CLEAN" },
          { seconds: 45.402, cones: 0, disposition: "CLEAN" },
          { seconds: 45.349, cones: 0, disposition: "CLEAN" },
          { seconds: 46.741, cones: 1, disposition: "CLEAN" },
          { seconds: 45.693, cones: 0, disposition: "CLEAN" },
        ],
      },
      {
        classCode: "AS", position: 5, trophy: false, carNumber: "3", altCarNumber: null,
        firstName: "", lastName: "", carDescription: null, hometown: null,
        bestSeconds: 47.736,
        runs: [
          { seconds: 51.386, cones: 0, disposition: "CLEAN" },
          { seconds: 52.045, cones: 0, disposition: "CLEAN" },
          { seconds: 49.225, cones: 0, disposition: "DNF" },
          { seconds: 47.797, cones: 1, disposition: "CLEAN" },
          { seconds: 48.234, cones: 0, disposition: "CLEAN" },
          { seconds: 47.736, cones: 0, disposition: "CLEAN" },
        ],
      },
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await ingestRmsoloEvent({ parsed: withAnonymous, sha256: "anon1", date: "2026-04-18" }, prisma);
    expect(result.status).toBe("ingested");

    const anonWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("printed no driver name"),
    );
    expect(anonWarnings).toHaveLength(1);
    expect(anonWarnings[0]![0]).toMatch(/2 entries/);
    warnSpy.mockRestore();

    const driver33 = await prisma.driver.findFirst({ where: { lastInitial: "#33" } });
    const driver3 = await prisma.driver.findFirst({ where: { lastInitial: "#3" } });
    expect(driver33).toMatchObject({ firstName: "Unknown", lastInitial: "#33" });
    expect(driver3).toMatchObject({ firstName: "Unknown", lastInitial: "#3" });
    expect(driver33!.id).not.toBe(driver3!.id); // distinct drivers, not collapsed to one

    const entry33 = await prisma.entry.findFirst({ where: { carNumber: "33" }, include: { runs: true } });
    expect(entry33!.driverId).toBe(driver33!.id);
    expect(entry33!.runs).toHaveLength(6);
    expect(entry33!.bestCommittedRunNumber).toBe(4); // printed Best 45.349 = run 4

    const entry3 = await prisma.entry.findFirst({ where: { carNumber: "3" }, include: { runs: true } });
    expect(entry3!.driverId).toBe(driver3!.id);
    expect(entry3!.runs).toHaveLength(6);
    expect(entry3!.bestCommittedRunNumber).toBe(6); // printed Best 47.736 = run 6 (a DNF sits at run 3)
  });

  it("is idempotent on sha for events containing anonymous entries", async () => {
    const withAnonymous = structuredClone(parsed);
    withAnonymous.entries.push({
      classCode: "AS", position: 3, trophy: false, carNumber: "33", altCarNumber: null,
      firstName: "", lastName: "", carDescription: null, hometown: null,
      bestSeconds: 45.349,
      runs: [{ seconds: 45.349, cones: 0, disposition: "CLEAN" }],
    });
    await ingestRmsoloEvent({ parsed: withAnonymous, sha256: "anon2", date: "2026-04-18" }, prisma);
    const again = await ingestRmsoloEvent({ parsed: withAnonymous, sha256: "anon2", date: "2026-04-18" }, prisma);
    expect(again.status).toBe("unchanged");
  });
});

describe("run-group paxClass derivation", () => {
  // An "X" run-group section prints PAX-indexed Best values. The driver's
  // underlying class is never printed, but factor = printedBest / bestPenalizedRaw
  // recovers it: 33.460 / 40.024 = 0.83600 → AST (see nearestPaxClass).
  const withRunGroup: ParsedRmsoloEvent = {
    title: "Summer 2026#9",
    classCodes: ["AS", "X"],
    entries: [
      {
        classCode: "AS", position: 1, trophy: true, carNumber: "1", altCarNumber: null,
        firstName: "Alice", lastName: "Fast", carDescription: null, hometown: null,
        bestSeconds: 40.0,
        runs: [
          { seconds: 40.0, cones: 0, disposition: "CLEAN" },
          { seconds: 41.0, cones: 0, disposition: "CLEAN" },
        ],
      },
      {
        classCode: "AS", position: 2, trophy: false, carNumber: "2", altCarNumber: null,
        firstName: "Bob", lastName: "Quick", carDescription: null, hometown: null,
        bestSeconds: 41.5,
        runs: [{ seconds: 41.5, cones: 0, disposition: "CLEAN" }],
      },
      {
        classCode: "X", position: 1, trophy: true, carNumber: "198", altCarNumber: null,
        firstName: "David", lastName: "Fauth", carDescription: null, hometown: null,
        bestSeconds: 33.46, // 40.024 × 0.836 (AST) — indexed Best, unreconcilable as raw
        runs: [
          { seconds: 40.024, cones: 0, disposition: "CLEAN" },
          { seconds: 41.787, cones: 1, disposition: "CLEAN" },
        ],
      },
    ],
  };

  it("assigns the derived class as paxClass while the entered class stays the run group", async () => {
    await ingestRmsoloEvent({ parsed: withRunGroup, sha256: "paxderive1", date: "2026-09-01" }, prisma);
    const entry = await prisma.entry.findFirst({
      where: { carNumber: "198", event: { slug: "2026-09-01-summer-2026-9" } },
      include: { class: true, paxClass: true },
    });
    expect(entry!.class.code).toBe("X");
    expect(entry!.paxClass.code).toBe("AST");
    expect(Number(entry!.paxClass.paxIndex)).toBe(0.836);
    expect(entry!.paxClass.leagueId).toBe(leagueId);
  });

  it("reconciled entries keep paxClass = entered class", async () => {
    const entry = await prisma.entry.findFirst({
      where: { carNumber: "1", event: { slug: "2026-09-01-summer-2026-9" } },
      include: { class: true, paxClass: true },
    });
    expect(entry!.paxClass.code).toBe("AS");
  });
});

describe("Entry.paxIndexApplied snapshot", () => {
  // The run-group derivation event (carNumber 198 → paxClass AST @ 0.836,
  // fallback entries → paxClass = entered class) is ingested in the block above,
  // so by now the DB holds both normal-class entries and a derived-factor one.
  it("stamps paxIndexApplied equal to the resolved paxClass factor for every entry", async () => {
    const entries = await prisma.entry.findMany({ include: { paxClass: true } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.paxIndexApplied, `entry ${e.id} should carry paxIndexApplied`).not.toBeNull();
      expect(Number(e.paxIndexApplied)).toBeCloseTo(Number(e.paxClass.paxIndex), 6);
    }
  });

  it("stamps the derived run-group factor (not 1.0) on the paxClass-derived entry", async () => {
    const entry = await prisma.entry.findFirstOrThrow({
      where: { carNumber: "198", event: { slug: "2026-09-01-summer-2026-9" } },
      include: { paxClass: true },
    });
    expect(Number(entry.paxIndexApplied)).toBeCloseTo(0.836, 6);
    expect(entry.paxClass.code).toBe("AST");
  });

  it("snapshot survives a later factor change", async () => {
    const entry = await prisma.entry.findFirstOrThrow({ include: { paxClass: true } });
    const before = Number(entry.paxIndexApplied);
    await prisma.carClass.update({ where: { id: entry.paxClassId }, data: { paxIndex: 0.5 } });
    const after = await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(Number(after.paxIndexApplied)).toBe(before); // frozen — decoupled from the live CarClass
  });
});

describe("duplicate driver-in-class collapse (shared-car anomaly)", () => {
  // RMsolo publishes no MSR uid, so Driver identity is name-only. Real source
  // PDFs occasionally print the same driver twice in one class on a shared
  // car (observed on event SS7): car #76 with real times (won the class,
  // 37.903) and car #176 all-DNS for the same name. Both rows resolve to the
  // same (driverId, classId) and, without collapsing, trip the
  // one-entry-per-driver-per-class guard on every ingest of that event.
  const duplicateDriver: ParsedRmsoloEvent = {
    title: "Summer 2026#7",
    classCodes: ["SS"],
    entries: [
      {
        classCode: "SS", position: 1, trophy: true, carNumber: "76", altCarNumber: null,
        firstName: "Casey", lastName: "Twin", carDescription: "2020 Porsche Cayman", hometown: null,
        bestSeconds: 37.903,
        runs: [
          { seconds: 38.5, cones: 0, disposition: "CLEAN" },
          { seconds: 37.903, cones: 0, disposition: "CLEAN" },
        ],
      },
      {
        classCode: "SS", position: 2, trophy: false, carNumber: "176", altCarNumber: null,
        firstName: "Casey", lastName: "Twin", carDescription: null, hometown: null,
        bestSeconds: null,
        runs: [],
      },
    ],
  };

  it("keeps the row with runs and drops the all-DNS duplicate for the same driver and class", async () => {
    const result = await ingestRmsoloEvent({ parsed: duplicateDriver, sha256: "dupe1", date: "2026-07-26" }, prisma);
    expect(result.status).toBe("ingested");

    const entries = await prisma.entry.findMany({
      where: { event: { slug: result.event.slug } },
      include: { runs: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.carNumber).toBe("76");
    expect(entries[0]!.runs).toHaveLength(2);
  });

  it("still rejects when both duplicate rows carry real runs (genuine anomaly)", async () => {
    const bothWithRuns = structuredClone(duplicateDriver);
    bothWithRuns.entries[1]!.bestSeconds = 40.0;
    bothWithRuns.entries[1]!.runs = [{ seconds: 40.0, cones: 0, disposition: "CLEAN" }];

    await expect(
      ingestRmsoloEvent({ parsed: bothWithRuns, sha256: "dupe2", date: "2026-07-26" }, prisma),
    ).rejects.toThrow(/data anomaly/);
  });

  it("keeps the first row when all duplicate rows are all-DNS", async () => {
    const bothAllDns = structuredClone(duplicateDriver);
    bothAllDns.entries[0]!.bestSeconds = null;
    bothAllDns.entries[0]!.runs = [];
    // A best-bearing bystander entry, so reconcileTimes has something to
    // anchor an interpretation on (an event where every entry is all-DNS has
    // no printed Best at all to reconcile against, which is a different,
    // unrelated failure mode from the one under test here).
    bothAllDns.entries.push({
      classCode: "SS", position: 3, trophy: false, carNumber: "9", altCarNumber: null,
      firstName: "Jamie", lastName: "Solo", carDescription: null, hometown: null,
      bestSeconds: 30.0,
      runs: [{ seconds: 30.0, cones: 0, disposition: "CLEAN" }],
    });

    const result = await ingestRmsoloEvent({ parsed: bothAllDns, sha256: "dupe3", date: "2026-07-26" }, prisma);
    expect(result.status).toBe("ingested");

    const allEntries = await prisma.entry.findMany({ where: { event: { slug: result.event.slug } } });
    expect(allEntries).toHaveLength(2); // collapsed duplicate (Casey Twin) + bystander (Jamie Solo)

    const duplicateEntries = await prisma.entry.findMany({
      where: { event: { slug: result.event.slug }, carNumber: { in: ["76", "176"] } },
      include: { runs: true },
    });
    expect(duplicateEntries).toHaveLength(1);
    expect(duplicateEntries[0]!.carNumber).toBe("76"); // first row wins, order preserved
    expect(duplicateEntries[0]!.runs).toHaveLength(0);
  });
});
