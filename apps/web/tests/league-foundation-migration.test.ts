import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 20260722020000_league_foundation migration is the single biggest
// hand-written migration in the app: it creates League/ScoringSystem/Season/
// LeagueMembership, seeds the default PCA league + preset + one Season per
// year already present in Event rows, then table-rebuilds Event (backfilling
// the new required seasonId by year-join) and CarClass (backfilling the new
// required leagueId) — see that migration's header comment for the exact
// five-step order. Every prior test file exercising this migration does so
// indirectly, through `prisma migrate deploy` against an otherwise-empty DB
// (so the year-join backfill never actually has more than a couple of rows
// to join). This file targets the backfill join itself: a scratch DB
// hand-built to the exact pre-league_foundation schema (mirroring
// tests/season-slug-migration.test.ts's approach — see that file's header
// for why raw SQL against a hand-built pre-state beats a second `prisma
// migrate deploy` run), seeded with Events spanning multiple years plus
// CarClasses and Entries, then the migration's real SQL is executed against
// it directly and the backfill is asserted.

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260722020000_league_foundation/migration.sql",
);

const tmpDir = mkdtempSync(join(tmpdir(), "league-foundation-migration-test-"));
const dbPath = join(tmpDir, "pre-migration.db");
let db: Database.Database;

// Row counts inserted below, asserted preserved (not merely "some rows
// exist") after the migration's table rebuilds.
const EVENT_COUNT = 5; // 2 in 2025, 3 in 2026
const CAR_CLASS_COUNT = 2; // AS, BST
const ENTRY_COUNT = 4;

beforeAll(() => {
  db = new Database(dbPath);

  // Mirrors the schema state immediately before league_foundation runs:
  // Event as left by 20260722010000_rename_source_sha (sourceSha256, no
  // seasonId yet), CarClass as left by the init migration (no leagueId yet),
  // Driver as left by 20260716120000_driver_name_only_hash, and Entry as
  // left by 20260526163256_committed_run_and_off_dsq — the full chain of
  // migrations between init and league_foundation, condensed to their final
  // column shapes (see each migration's file for the individual deltas).
  db.exec(`
    CREATE TABLE "Event" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "msrEventId" TEXT,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "date" DATETIME NOT NULL,
        "location" TEXT,
        "sourceSha256" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "Event_msrEventId_key" ON "Event"("msrEventId");
    CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

    CREATE TABLE "Driver" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "msrUid" TEXT,
        "firstName" TEXT NOT NULL,
        "lastInitial" TEXT NOT NULL,
        "identityHash" TEXT NOT NULL,
        "memberNum" TEXT,
        "nameOnlyHash" TEXT
    );
    CREATE UNIQUE INDEX "Driver_msrUid_key" ON "Driver"("msrUid");
    CREATE UNIQUE INDEX "Driver_identityHash_key" ON "Driver"("identityHash");
    CREATE UNIQUE INDEX "Driver_memberNum_key" ON "Driver"("memberNum");
    CREATE INDEX "Driver_nameOnlyHash_idx" ON "Driver"("nameOnlyHash");

    CREATE TABLE "CarClass" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "code" TEXT NOT NULL,
        "paxIndex" DECIMAL NOT NULL DEFAULT 1.0000
    );
    CREATE UNIQUE INDEX "CarClass_code_key" ON "CarClass"("code");

    CREATE TABLE "Entry" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "eventId" INTEGER NOT NULL,
        "driverId" INTEGER NOT NULL,
        "classId" INTEGER NOT NULL,
        "paxClassId" INTEGER NOT NULL,
        "carNumber" TEXT NOT NULL,
        "carDescription" TEXT,
        "bestCommittedRunNumber" INTEGER,
        CONSTRAINT "Entry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "Entry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "Entry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CarClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "Entry_paxClassId_fkey" FOREIGN KEY ("paxClassId") REFERENCES "CarClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE INDEX "Entry_eventId_idx" ON "Entry"("eventId");
    CREATE INDEX "Entry_driverId_idx" ON "Entry"("driverId");
  `);

  // 2 CarClasses.
  const insertClass = db.prepare(`INSERT INTO "CarClass" ("code", "paxIndex") VALUES (?, ?)`);
  const as = insertClass.run("AS", 0.83);
  const bst = insertClass.run("BST", 0.835);

  // 2 drivers.
  const insertDriver = db.prepare(
    `INSERT INTO "Driver" ("firstName", "lastInitial", "identityHash") VALUES (?, ?, ?)`,
  );
  const alice = insertDriver.run("Alice", "A.", "alice-hash");
  const bob = insertDriver.run("Bob", "B.", "bob-hash");

  // 5 events across 2 distinct years (2025 x2, 2026 x3) — the exact join key
  // (strftime('%Y', date)) the migration groups Season rows by.
  const insertEvent = db.prepare(
    `INSERT INTO "Event" ("slug", "name", "date") VALUES (?, ?, ?)`,
  );
  const events = [
    insertEvent.run("2025-opener", "2025 Opener", "2025-04-12T00:00:00.000Z"),
    insertEvent.run("2025-closer", "2025 Closer", "2025-10-04T00:00:00.000Z"),
    insertEvent.run("2026-opener", "2026 Opener", "2026-04-18T00:00:00.000Z"),
    insertEvent.run("2026-mid", "2026 Midseason", "2026-06-20T00:00:00.000Z"),
    insertEvent.run("2026-closer", "2026 Closer", "2026-09-19T00:00:00.000Z"),
  ];

  // 4 entries spread across events/classes/drivers.
  const insertEntry = db.prepare(
    `INSERT INTO "Entry" ("eventId", "driverId", "classId", "paxClassId", "carNumber") VALUES (?, ?, ?, ?, ?)`,
  );
  insertEntry.run(events[0]!.lastInsertRowid, alice.lastInsertRowid, as.lastInsertRowid, as.lastInsertRowid, "1");
  insertEntry.run(events[1]!.lastInsertRowid, bob.lastInsertRowid, bst.lastInsertRowid, bst.lastInsertRowid, "2");
  insertEntry.run(events[2]!.lastInsertRowid, alice.lastInsertRowid, as.lastInsertRowid, as.lastInsertRowid, "1");
  insertEntry.run(events[4]!.lastInsertRowid, bob.lastInsertRowid, bst.lastInsertRowid, bst.lastInsertRowid, "2");

  db.exec(readFileSync(MIGRATION_SQL_PATH, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("20260722020000_league_foundation migration backfill join", () => {
  it("seeds exactly one League row (the default pca-rmr league)", () => {
    const leagues = db.prepare(`SELECT "id", "slug" FROM "League"`).all() as Array<{
      id: number;
      slug: string;
    }>;
    expect(leagues).toHaveLength(1);
    expect(leagues[0]!.slug).toBe("pca-rmr");
  });

  it("seeds one Season row per distinct year present in Event rows (2025, 2026)", () => {
    const seasons = db
      .prepare(`SELECT "year", "plannedEvents" FROM "Season" ORDER BY "year"`)
      .all() as Array<{ year: number; plannedEvents: number }>;
    expect(seasons.map((s) => s.year)).toEqual([2025, 2026]);
  });

  it("plannedEvents: 2026 -> 6 (production default), every other year -> 0", () => {
    const seasons = db
      .prepare(`SELECT "year", "plannedEvents" FROM "Season" ORDER BY "year"`)
      .all() as Array<{ year: number; plannedEvents: number }>;
    expect(seasons.find((s) => s.year === 2025)!.plannedEvents).toBe(0);
    expect(seasons.find((s) => s.year === 2026)!.plannedEvents).toBe(6);
  });

  it("every event's seasonId matches a Season row for its own calendar year", () => {
    const rows = db
      .prepare(
        `SELECT e."slug" AS slug, e."date" AS date, s."year" AS seasonYear
         FROM "Event" e JOIN "Season" s ON s."id" = e."seasonId"
         ORDER BY e."id"`,
      )
      .all() as Array<{ slug: string; date: string; seasonYear: number }>;
    expect(rows).toHaveLength(EVENT_COUNT);
    for (const row of rows) {
      const eventYear = new Date(row.date).getUTCFullYear();
      expect(row.seasonYear).toBe(eventYear);
    }
    // Pin the exact grouping too: both 2026 events one season, both 2025 on another.
    const seasonIdByYear = new Map(
      (db.prepare(`SELECT "id", "year" FROM "Season"`).all() as Array<{ id: number; year: number }>).map(
        (s) => [s.year, s.id],
      ),
    );
    const seasonIds = db.prepare(`SELECT "seasonId" FROM "Event"`).all() as Array<{ seasonId: number }>;
    expect(seasonIds.filter((r) => r.seasonId === seasonIdByYear.get(2025)!)).toHaveLength(2);
    expect(seasonIds.filter((r) => r.seasonId === seasonIdByYear.get(2026)!)).toHaveLength(3);
  });

  it("every Season row belongs to the seeded pca-rmr league", () => {
    const rows = db
      .prepare(
        `SELECT s."id" FROM "Season" s JOIN "League" l ON l."id" = s."leagueId" WHERE l."slug" = 'pca-rmr'`,
      )
      .all();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM "Season"`).get() as { n: number };
    expect(rows).toHaveLength(total.n);
  });

  it("backfills every CarClass row's leagueId to the pca-rmr league, preserving row count and ids", () => {
    const rows = db
      .prepare(
        `SELECT c."id", c."code" FROM "CarClass" c JOIN "League" l ON l."id" = c."leagueId" WHERE l."slug" = 'pca-rmr' ORDER BY c."id"`,
      )
      .all() as Array<{ id: number; code: string }>;
    expect(rows).toHaveLength(CAR_CLASS_COUNT);
    expect(rows.map((r) => r.code)).toEqual(["AS", "BST"]);
    // Ids preserved (1, 2 — table-rebuild INSERT...SELECT carries the old ids forward).
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("preserves every Event and Entry row (no data lost across the table rebuilds)", () => {
    const eventCount = db.prepare(`SELECT COUNT(*) AS n FROM "Event"`).get() as { n: number };
    const entryCount = db.prepare(`SELECT COUNT(*) AS n FROM "Entry"`).get() as { n: number };
    expect(eventCount.n).toBe(EVENT_COUNT);
    expect(entryCount.n).toBe(ENTRY_COUNT);
  });

  it("every Entry's FKs still resolve after the Event/CarClass rebuilds (ids preserved)", () => {
    const dangling = db
      .prepare(
        `SELECT en."id" FROM "Entry" en
         LEFT JOIN "Event" e ON e."id" = en."eventId"
         LEFT JOIN "CarClass" cc ON cc."id" = en."classId"
         LEFT JOIN "CarClass" pc ON pc."id" = en."paxClassId"
         LEFT JOIN "Driver" d ON d."id" = en."driverId"
         WHERE e."id" IS NULL OR cc."id" IS NULL OR pc."id" IS NULL OR d."id" IS NULL`,
      )
      .all();
    expect(dangling).toHaveLength(0);
  });
});
