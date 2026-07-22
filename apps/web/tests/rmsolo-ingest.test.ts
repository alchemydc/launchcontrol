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
  it("creates event, classes, drivers with full lastName, entries, runs", async () => {
    const result = await ingestRmsoloEvent({ parsed, sha256: "abc123", date: "2026-04-18" }, prisma);
    expect(result.status).toBe("ingested");
    expect(result.event.slug).toBe("2026-04-18-summer-2026-1");

    const drivers = await prisma.driver.findMany({ orderBy: { id: "asc" } });
    expect(drivers).toHaveLength(2); // same last name, different first → distinct identityHash
    expect(drivers[0]).toMatchObject({ firstName: "Alex", lastName: "Driver", lastInitial: "D." });
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
});
