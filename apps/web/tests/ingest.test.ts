import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { computeNameOnlyHash, ingestAxdb, normalizeMemberNum } from "@/lib/ingest";

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

  it("stamps paxIndexApplied from the source file's class factor", async () => {
    const entries = await prisma.entry.findMany({ include: { paxClass: true } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.paxIndexApplied).not.toBeNull();
      expect(Number(e.paxIndexApplied)).toBeCloseTo(Number(e.paxClass.paxIndex), 6);
    }
  });
});

describe("normalizeMemberNum", () => {
  it("passes through a plain member number", () => {
    expect(normalizeMemberNum("123")).toBe("123");
  });

  it("strips a space-separated 'verified' suffix", () => {
    expect(normalizeMemberNum("123 verified")).toBe("123");
  });

  it("strips a hyphen-separated 'verified' suffix", () => {
    expect(normalizeMemberNum("123-verified")).toBe("123");
  });

  it("strips an uppercase 'VERIFIED' suffix", () => {
    expect(normalizeMemberNum("123-VERIFIED")).toBe("123");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeMemberNum("  123  ")).toBe("123");
  });

  it("returns null for whitespace-only input", () => {
    expect(normalizeMemberNum("   ")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeMemberNum(null)).toBeNull();
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

describe("ingestAxdb throws on multi-event source", () => {
  it("rejects a .axdb with more than one event row", async () => {
    const fixture = resolve(__dirname, "fixtures", "multi-event-rejection.axdb");
    // Throw occurs before any Prisma op, so reusing the outer client is safe.
    await expect(ingestAxdb(fixture, prisma)).rejects.toThrow(
      /Source \.axdb contains 2 events; ingest supports single-event files only\./,
    );
  });
});

describe("computeNameOnlyHash", () => {
  it("hashes lowercased, trimmed 'first|last'", () => {
    const expected = createHash("sha256").update("alex|ada").digest("hex");
    expect(computeNameOnlyHash("Alex", "Ada")).toBe(expected);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(computeNameOnlyHash("  ALEX  ", "  ADA  ")).toBe(computeNameOnlyHash("alex", "ada"));
  });

  it("differs from a blank-member identityHash for the same name (different key shape: 'first|last' vs '|first|last')", () => {
    const blankMemberIdentityHash = createHash("sha256").update("|alex|ada").digest("hex");
    expect(computeNameOnlyHash("Alex", "Ada")).not.toBe(blankMemberIdentityHash);
  });
});

// ---------------------------------------------------------------------------
// Driver identity self-healing: nameOnlyHash merge/adopt at ingest time.
//
// Each scenario gets its own minimal single-event .axdb (one class, one driver
// per row, one clean run each) — only driver identity resolution is under
// test, not scoring. Names/member numbers below are entirely synthetic.
// ---------------------------------------------------------------------------

type MiniDriver = {
  id: number;
  first: string;
  last: string;
  memberNum: string | null;
  num: string;
  classId?: number; // defaults to 1 (C1); use 2 (CS) to give a same-event, same-name row a distinct
                     // (driverId, classId) pair so a within-file merge doesn't collide on Entry recovery.
};

function buildMiniAxdb(path: string, eventDate: string, eventName: string, drivers: MiniDriver[]): void {
  const src = new Database(path);
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
  src
    .prepare(
      `INSERT INTO events (id, event_name, event_date, num_runs, mirrored, unique_numbers, org_name, timing_mode, typical_time, web_active, run_timestamp)
       VALUES (1, ?, ?, 1, 0, 0, 'Synthetic Region', 0, 55.0, 1, 0)`,
    )
    .run(eventName, eventDate);
  src.prepare(`INSERT INTO classes (id, class_name, paxed_class, pax, run_timestamp) VALUES (1, 'C1', 0, 1.0, 0)`).run();
  src.prepare(`INSERT INTO classes (id, class_name, paxed_class, pax, run_timestamp) VALUES (2, 'CS', 1, 0.92, 0)`).run();

  const insertDriver = src.prepare(
    `INSERT INTO drivers (id, last_name, first_name, number, class_id, paxmult_id, member_num, member, registered)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  const insertRun = src.prepare(
    `INSERT INTO runs (id, event_id, driver_id, start_tick, finish_tick, cones, disposition, status)
     VALUES (?, 1, ?, 0, 60000, 0, '', 3)`,
  );
  const insertReg = src.prepare(
    `INSERT INTO registrations (driver_id, event_id, bestcommittedrun_id, bestcommittedrun_no, run_timestamp)
     VALUES (?, 1, ?, 1, 0)`,
  );

  for (const d of drivers) {
    const classId = d.classId ?? 1;
    insertDriver.run(d.id, d.last, d.first, d.num, classId, classId, d.memberNum);
    insertRun.run(d.id, d.id); // one run per driver; reuse driver id as run id (both start at 1, distinct sequences)
    insertReg.run(d.id, d.id);
  }
  src.close();
}

describe("driver identity self-healing (nameOnlyHash merge/adopt)", () => {
  const TEST_DB_PATH = resolve(__dirname, "..", "test-identity-heal.db");
  const TEST_DB_URL = "file:./test-identity-heal.db";
  let healPrisma: PrismaClient;
  const tmpFiles: string[] = [];

  function tmpAxdb(): string {
    const p = join(tmpdir(), `ingest-test-identity-${randomUUID()}.axdb`);
    tmpFiles.push(p);
    return p;
  }

  beforeAll(() => {
    rmSync(TEST_DB_PATH, { force: true });
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: resolve(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: "pipe",
    });
    const adapter = new PrismaLibSql({ url: TEST_DB_URL });
    healPrisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await healPrisma.$disconnect();
    rmSync(TEST_DB_PATH, { force: true });
    for (const f of tmpFiles) rmSync(f, { force: true });
  });

  it("merge-back: a populated driver ingested first, then a blank-member row with the same full name, collapse to one Driver with entries from both events", async () => {
    const populated = tmpAxdb();
    buildMiniAxdb(populated, "2024-05-01", "Heal Merge-Back Populated", [
      { id: 1, first: "Jordan", last: "Blake", memberNum: "SYN-101", num: "201" },
    ]);
    const blank = tmpAxdb();
    buildMiniAxdb(blank, "2024-06-01", "Heal Merge-Back Blank", [
      { id: 1, first: "Jordan", last: "Blake", memberNum: null, num: "201" },
    ]);

    await ingestAxdb(populated, healPrisma);
    await ingestAxdb(blank, healPrisma);

    const jordans = await healPrisma.driver.findMany({ where: { firstName: "Jordan", lastInitial: "B." } });
    expect(jordans).toHaveLength(1);
    expect(jordans[0]!.memberNum).toBe("SYN-101");

    const entries = await healPrisma.entry.findMany({ where: { driverId: jordans[0]!.id } });
    expect(entries).toHaveLength(2);
  });

  it("adopt-forward: a blank-member row ingested first, then a populated row with the same full name, update the same Driver row in place", async () => {
    const blank = tmpAxdb();
    buildMiniAxdb(blank, "2024-05-02", "Heal Adopt-Forward Blank", [
      { id: 1, first: "Sam", last: "Reyes", memberNum: null, num: "202" },
    ]);
    const populated = tmpAxdb();
    buildMiniAxdb(populated, "2024-06-02", "Heal Adopt-Forward Populated", [
      { id: 1, first: "Sam", last: "Reyes", memberNum: "SYN-102", num: "202" },
    ]);

    await ingestAxdb(blank, healPrisma);
    const beforeAdopt = await healPrisma.driver.findFirst({ where: { firstName: "Sam", lastInitial: "R." } });
    expect(beforeAdopt).not.toBeNull();
    expect(beforeAdopt!.memberNum).toBeNull();

    await ingestAxdb(populated, healPrisma);
    const sams = await healPrisma.driver.findMany({ where: { firstName: "Sam", lastInitial: "R." } });
    expect(sams).toHaveLength(1);
    expect(sams[0]!.id).toBe(beforeAdopt!.id); // same row, updated in place
    expect(sams[0]!.memberNum).toBe("SYN-102");

    const entries = await healPrisma.entry.findMany({ where: { driverId: sams[0]!.id } });
    expect(entries).toHaveLength(2);
  });

  it("ambiguity: two populated drivers sharing a full name but different member numbers stay separate, and a later blank row with that name becomes a third, separate Driver", async () => {
    const first = tmpAxdb();
    buildMiniAxdb(first, "2024-05-03", "Heal Ambiguity First", [
      { id: 1, first: "Taylor", last: "Nguyen", memberNum: "SYN-201", num: "203" },
    ]);
    const second = tmpAxdb();
    buildMiniAxdb(second, "2024-06-03", "Heal Ambiguity Second", [
      { id: 1, first: "Taylor", last: "Nguyen", memberNum: "SYN-202", num: "204" },
    ]);
    const blank = tmpAxdb();
    buildMiniAxdb(blank, "2024-07-03", "Heal Ambiguity Blank", [
      { id: 1, first: "Taylor", last: "Nguyen", memberNum: null, num: "205" },
    ]);

    await ingestAxdb(first, healPrisma);
    await ingestAxdb(second, healPrisma);
    await ingestAxdb(blank, healPrisma);

    const taylors = await healPrisma.driver.findMany({ where: { firstName: "Taylor", lastInitial: "N." } });
    expect(taylors).toHaveLength(3);
    const memberNums = taylors.map((d) => d.memberNum).sort();
    expect(memberNums).toEqual(["SYN-201", "SYN-202", null]); // default sort stringifies null → "null", sorting after "SYN-*"
  });

  it("within-file: a populated row and a blank row with the same full name in one file collapse to one Driver", async () => {
    const file = tmpAxdb();
    buildMiniAxdb(file, "2024-05-04", "Heal Within-File", [
      { id: 1, first: "Morgan", last: "Lee", memberNum: "SYN-301", num: "206", classId: 1 },
      { id: 2, first: "Morgan", last: "Lee", memberNum: null, num: "206X", classId: 2 }, // co-driver mis-entry, blank member_num, distinct class to avoid an Entry (driverId, classId) collision on merge
    ]);

    await ingestAxdb(file, healPrisma);

    const morgans = await healPrisma.driver.findMany({ where: { firstName: "Morgan", lastInitial: "L." } });
    expect(morgans).toHaveLength(1);
    expect(morgans[0]!.memberNum).toBe("SYN-301");

    const entries = await healPrisma.entry.findMany({ where: { driverId: morgans[0]!.id } });
    expect(entries).toHaveLength(2); // both source driver rows map to the same Driver
  });
});
