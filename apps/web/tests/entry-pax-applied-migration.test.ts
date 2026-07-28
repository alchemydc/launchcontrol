import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 20260724020000_entry_pax_applied migration adds the nullable
// Entry.paxIndexApplied column and backfills every pre-existing row from its
// paxClass's CURRENT live paxIndex (a plain ALTER TABLE ADD COLUMN + UPDATE —
// no table rebuild). Following the season-slug-migration.test.ts pattern, this
// test executes the migration's real SQL file directly against a hand-built
// "pre-migration-shaped" CarClass + Entry pair — the exact table shapes left
// behind by the league_logo_url migration (CarClass rebuilt in
// league_foundation; Entry defined in init, indexes/columns amended by
// entry_allow_multi and committed_run_and_off_dsq) — and asserts the backfill
// follows paxClassId, not classId.

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260724020000_entry_pax_applied/migration.sql",
);

const tmpDir = mkdtempSync(join(tmpdir(), "entry-pax-applied-migration-test-"));
const dbPath = join(tmpDir, "pre-migration.db");
let db: Database.Database;

beforeAll(() => {
  db = new Database(dbPath);
  // FK targets Event/Driver/League are intentionally not created; disable FK
  // enforcement so the inert constraints on the copied CREATE TABLE bodies
  // don't reject the seed. The migration under test is a plain ALTER TABLE ADD
  // COLUMN + UPDATE, so FK state does not affect it.
  db.pragma("foreign_keys = OFF");
  // Pre-migration state, copied verbatim from the actual migrations:
  //  - CarClass: rebuilt in 20260722020000_league_foundation (new_CarClass).
  //  - Entry:    created in 20260518214917_init, then indexes amended by
  //              20260518230343_entry_allow_multi (drop (eventId,driverId)
  //              unique, add driverId index) and column added by
  //              20260526163256_committed_run_and_off_dsq (bestCommittedRunNumber).
  // (FK targets Event/Driver/League are intentionally not created; SQLite
  // leaves foreign_keys OFF by default, so the constraints are inert here.)
  db.exec(`
    CREATE TABLE "CarClass" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "code" TEXT NOT NULL,
        "paxIndex" DECIMAL NOT NULL DEFAULT 1.0000,
        CONSTRAINT "CarClass_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "CarClass_leagueId_code_key" ON "CarClass"("leagueId", "code");

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
  db.exec(`
    INSERT INTO "CarClass" ("id","leagueId","code","paxIndex") VALUES
      (1, 1, 'AS', 0.821),
      (2, 1, 'CS', 0.809);
    INSERT INTO "Entry" ("id","eventId","driverId","classId","paxClassId","carNumber") VALUES
      (1, 1, 1, 1, 1, '11'),
      (2, 1, 2, 2, 1, '22'),   -- paxClass differs from class (run-group case)
      (3, 1, 3, 2, 2, '33');
  `);

  db.exec(readFileSync(MIGRATION_SQL_PATH, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("20260724020000_entry_pax_applied migration backfill", () => {
  it("backfills every entry from its paxClass (not class) and preserves rows", () => {
    const rows = db
      .prepare(`SELECT id, CAST(paxIndexApplied AS TEXT) AS pax FROM "Entry" ORDER BY id`)
      .all() as { id: number; pax: string }[];
    expect(rows).toEqual([
      { id: 1, pax: "0.821" },
      { id: 2, pax: "0.821" }, // followed paxClassId=1, NOT classId=2
      { id: 3, pax: "0.809" },
    ]);
  });

  it("leaves no null paxIndexApplied after backfill", () => {
    expect(
      db.prepare(`SELECT COUNT(*) c FROM "Entry" WHERE paxIndexApplied IS NULL`).get(),
    ).toEqual({ c: 0 });
  });
});
