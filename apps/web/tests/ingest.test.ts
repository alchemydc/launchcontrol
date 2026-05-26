import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";

const TEST_DB_PATH = resolve(__dirname, "..", "test.db");
const TEST_DB_URL = "file:./test.db";
const FIXTURE = resolve(__dirname, "fixtures", "synthetic.axdb");

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

describe("ingestAxdb(synthetic.axdb)", () => {
  it("ingests with the PRD DoD counts", async () => {
    const result = await ingestAxdb(FIXTURE, prisma);

    expect(result.status).toBe("ingested");
    expect(result.event.slug).toBe("2026-01-01-synthetic-fixture-event");
    // 19 status=3 runs ingested; the 1 status=4 (cancelled) run is excluded.
    expect(result.counts).toEqual({ classes: 3, drivers: 6, entries: 6, runs: 19 });

    const [dnf, rrn, off, dsq, clean] = await Promise.all([
      prisma.run.count({ where: { disposition: RunDisposition.DNF } }),
      prisma.run.count({ where: { disposition: RunDisposition.RRN } }),
      prisma.run.count({ where: { disposition: RunDisposition.OFF } }),
      prisma.run.count({ where: { disposition: RunDisposition.DSQ } }),
      prisma.run.count({ where: { disposition: RunDisposition.CLEAN } }),
    ]);
    expect(dnf).toBe(1);
    expect(rrn).toBe(1);
    expect(off).toBe(1);
    expect(dsq).toBe(1);
    expect(clean).toBe(15); // 19 status=3 total - 1 DNF - 1 RRN - 1 OFF - 1 DSQ = 15

    const classes = await prisma.carClass.findMany({ orderBy: { code: "asc" } });
    expect(classes.map((c) => c.code)).toEqual(["C1", "CS", "TO"]);
    expect(Number(classes[0]!.paxIndex)).toBe(1);
    expect(Number(classes[1]!.paxIndex)).toBeCloseTo(0.92, 4);
    expect(Number(classes[2]!.paxIndex)).toBeCloseTo(0.85, 4);
  });

  it("is idempotent: a second run reports 'unchanged'", async () => {
    const result = await ingestAxdb(FIXTURE, prisma);
    expect(result.status).toBe("unchanged");
    expect(result.counts).toEqual({ classes: 3, drivers: 6, entries: 6, runs: 19 });
  });

  it("preserves the DNF run (no rawTimeMs)", async () => {
    const dnfRuns = await prisma.run.findMany({
      where: { disposition: RunDisposition.DNF },
    });
    expect(dnfRuns).toHaveLength(1);
    expect(dnfRuns[0]!.rawTimeMs).toBeNull();
  });

  it("preserves the cone penalty on the seeded run", async () => {
    const coned = await prisma.run.findMany({ where: { cones: { gt: 0 } } });
    expect(coned).toHaveLength(1);
    expect(coned[0]!.cones).toBe(1);
  });

  it("redacts driver last names to a single initial + period", async () => {
    const drivers = await prisma.driver.findMany();
    expect(drivers).toHaveLength(6);

    for (const d of drivers) {
      expect(d.lastInitial).toMatch(/^[A-Z?]\.$/);
      expect(d.lastInitial).toHaveLength(2);
    }

    const initials = drivers.map((d) => d.lastInitial).sort();
    expect(initials).toEqual(["A.", "A.", "B.", "C.", "D.", "E."]);
  });

  it("never persists a full source last name anywhere in the Driver table", async () => {
    const drivers = await prisma.driver.findMany();
    const fixtureLastNames = ["Ada", "Brook", "Chen", "Diaz", "Eckhart"];
    for (const d of drivers) {
      const blob = JSON.stringify(d);
      for (const name of fixtureLastNames) {
        expect(
          blob.includes(name),
          `Driver row leaks full last name '${name}': ${blob}`,
        ).toBe(false);
      }
    }
  });

  it("excludes the status=4 (cancelled) run — only status=3 runs are persisted", async () => {
    // The fixture has 20 source runs: 19 status=3 and 1 status=4.
    // Only the 19 status=3 runs should be in the DB.
    const totalRuns = await prisma.run.count();
    expect(totalRuns).toBe(19);
  });

  it("persists OFF and DSQ runs with correct disposition", async () => {
    const off = await prisma.run.findMany({ where: { disposition: RunDisposition.OFF } });
    const dsq = await prisma.run.findMany({ where: { disposition: RunDisposition.DSQ } });
    expect(off).toHaveLength(1);
    expect(dsq).toHaveLength(1);
    // OFF run has no rawTimeMs (never crossed finish lights)
    expect(off[0]!.rawTimeMs).toBeNull();
  });

  it("sets bestCommittedRunNumber on Entry for the override driver (Alex Ada)", async () => {
    // Driver 1 (Alex Ada): fixture commits R2, even though R3 is the fastest clean run.
    const entry = await prisma.entry.findFirst({
      include: { driver: true },
      where: { driver: { firstName: "Alex", lastInitial: "A." } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.bestCommittedRunNumber).toBe(2);
  });

  it("all other entries have bestCommittedRunNumber set (not null)", async () => {
    // Every driver in the fixture has a registrations row with bestcommittedrun_no set.
    const entries = await prisma.entry.findMany();
    for (const e of entries) {
      expect(e.bestCommittedRunNumber, `entry ${e.id} should have bestCommittedRunNumber set`).not.toBeNull();
    }
  });
});

describe("ingestAxdb throws on unknown disposition", () => {
  it("throws on a run with an unrecognized disposition string", async () => {
    // Build a minimal in-memory .axdb with a 'WAT' disposition row.
    // Use a temp file (better-sqlite3 doesn't support true in-memory across ingest calls).
    const tmpPath = join(tmpdir(), `ingest-test-unknown-disposition-${randomUUID()}.axdb`);
    const testDbPath = join(tmpdir(), `ingest-test-db-${randomUUID()}.db`);
    const testDbUrl = `file:${testDbPath}`;
    let testPrisma: PrismaClient | null = null;

    try {
      const src = new Database(tmpPath);
      src.pragma("foreign_keys = OFF");
      src.exec(`
        CREATE TABLE events (id INTEGER PRIMARY KEY, event_name TEXT NOT NULL, event_date TEXT NOT NULL,
          num_runs INTEGER NOT NULL, mirrored INTEGER NOT NULL, unique_numbers INTEGER NOT NULL,
          org_name TEXT NOT NULL, timing_mode INTEGER NOT NULL, typical_time REAL NOT NULL,
          web_active INTEGER NOT NULL, run_timestamp INTEGER);
        CREATE TABLE classes (id INTEGER PRIMARY KEY, class_name TEXT NOT NULL UNIQUE,
          paxed_class INTEGER NOT NULL DEFAULT 0, pax REAL NOT NULL DEFAULT 1.0, run_timestamp INTEGER);
        CREATE TABLE drivers (id INTEGER PRIMARY KEY, last_name TEXT NOT NULL, first_name TEXT NOT NULL,
          number TEXT NOT NULL, class_id INTEGER NOT NULL, paxmult_id INTEGER NOT NULL,
          car_model TEXT, car_color TEXT, member_num TEXT, sponsor TEXT, tire TEXT,
          email TEXT, cellphone TEXT, member INTEGER, registered INTEGER, icon_color TEXT);
        CREATE TABLE registrations (driver_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
          bestcommittedrun_id INTEGER, bestcommittedrun_no INTEGER,
          bestpendingrun_id INTEGER, run_timestamp INTEGER);
        CREATE TABLE runs (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL,
          driver_id INTEGER NOT NULL, start_at INTEGER, finish_at INTEGER,
          start_tick INTEGER, finish_tick INTEGER, cones INTEGER,
          disposition TEXT, status INTEGER NOT NULL);
      `);
      src.prepare("INSERT INTO events VALUES (1,'Test','2026-01-01',1,0,0,'T',0,55,1,0)").run();
      src.prepare("INSERT INTO classes VALUES (1,'C1',0,1.0,0)").run();
      src.prepare("INSERT INTO drivers VALUES (1,'Test','Driver','99',1,1,null,null,'SYN-T',null,null,null,null,1,1,null)").run();
      src.prepare("INSERT INTO registrations VALUES (1,1,1,1,null,0)").run();
      src.prepare("INSERT INTO runs VALUES (1,1,1,0,1,1000,2000,0,'WAT',3)").run();
      src.close();

      // Set up a minimal test DB for this one-off test.
      rmSync(testDbPath, { force: true });
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        cwd: resolve(__dirname, ".."),
        env: { ...process.env, DATABASE_URL: testDbUrl },
        stdio: "pipe",
      });
      const adapter = new PrismaLibSql({ url: testDbUrl });
      testPrisma = new PrismaClient({ adapter });

      await expect(ingestAxdb(tmpPath, testPrisma)).rejects.toThrow(
        /unrecognized run disposition.*WAT/,
      );
    } finally {
      await testPrisma?.$disconnect();
      rmSync(testDbPath, { force: true });
      rmSync(tmpPath, { force: true });
    }
  });
});
