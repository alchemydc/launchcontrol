import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Unique per-file DB path (not the shared test.db) so this file's beforeAll
// (rmSync + `prisma migrate deploy`) can't race another test file's DB reset
// when vitest runs test files concurrently — see admin-events.test.ts,
// driver-history.test.ts, combined-event.test.ts, season-leaderboard.test.ts.
const TEST_DB_PATH = resolve(__dirname, "..", "test-rmsolo-ingest.db");
const TEST_DB_URL = "file:./test-rmsolo-ingest.db";

let prisma: PrismaClient;

beforeAll(() => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
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
  it("creates event, classes, drivers with redacted initials, entries, runs", async () => {
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
  });

  it("reconciled entries keep paxClass = entered class", async () => {
    const entry = await prisma.entry.findFirst({
      where: { carNumber: "1", event: { slug: "2026-09-01-summer-2026-9" } },
      include: { class: true, paxClass: true },
    });
    expect(entry!.paxClass.code).toBe("AS");
  });
});
