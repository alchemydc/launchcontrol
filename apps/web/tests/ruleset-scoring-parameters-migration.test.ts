import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScoringPolicy } from "@/lib/scoring-policy";

const migrationPath = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260725020000_ruleset_scoring_parameters/migration.sql",
);
const tmpDir = mkdtempSync(join(tmpdir(), "ruleset-scoring-parameters-"));
const dbPath = join(tmpDir, "migration.db");

let db: Database.Database;

const PCA_V2 = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';
const RMSOLO_V2 =
  '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":1500}';

beforeAll(() => {
  db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE "League" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL
    );
    CREATE TABLE "ScoringSystem" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "leagueId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "policy" TEXT NOT NULL,
      "paxTable" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ScoringSystem_leagueId_fkey"
        FOREIGN KEY ("leagueId") REFERENCES "League" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "ScoringSystem_leagueId_name_key"
      ON "ScoringSystem"("leagueId", "name");

    CREATE TABLE "Season" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "leagueId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "year" INTEGER NOT NULL,
      "plannedEvents" INTEGER NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'active',
      "rulesetId" INTEGER NOT NULL,
      CONSTRAINT "Season_leagueId_fkey"
        FOREIGN KEY ("leagueId") REFERENCES "League" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Season_rulesetId_fkey"
        FOREIGN KEY ("rulesetId") REFERENCES "ScoringSystem" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");
    CREATE UNIQUE INDEX "Season_leagueId_slug_key" ON "Season"("leagueId", "slug");
    CREATE INDEX "Season_leagueId_year_idx" ON "Season"("leagueId", "year");

    CREATE TABLE "Event" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      CONSTRAINT "Event_seasonId_fkey"
        FOREIGN KEY ("seasonId") REFERENCES "Season" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    );

    INSERT INTO "League" ("id", "name") VALUES
      (1, 'PCA Rocky Mountain Region'),
      (2, 'Rocky Mountain Solo');

    INSERT INTO "ScoringSystem" ("id", "leagueId", "name", "policy", "paxTable") VALUES
      (1, 1, 'PCA Classic', '${PCA_V2}', '{"C1":1}'),
      (2, 2, 'RMsolo Summer', '${RMSOLO_V2}', '{"AS":0.83}'),
      (3, 1, 'PCA Classic [v3-5]', '${PCA_V2}', '{}');

    INSERT INTO "Season"
      ("id", "leagueId", "name", "slug", "year", "plannedEvents", "status", "rulesetId")
    VALUES
      (1, 1, '2024 Season', '2024-season', 2024, 0, 'completed', 1),
      (2, 1, '2025 Season', '2025-season', 2025, 0, 'completed', 1),
      (3, 1, '2026 Season', '2026-season', 2026, 6, 'active', 1),
      (4, 2, '2026 Summer', '2026-summer', 2026, 10, 'active', 2),
      (5, 2, '2025 Season', '2025-season', 2025, 0, 'completed', 2),
      (6, 2, '2024 Season', '2024-season', 2024, 0, 'completed', 2),
      (7, 1, 'Future Empty', 'future-empty', 2030, 0, 'completed', 1),
      (8, 1, '2025 Second Series', '2025-second', 2025, 7, 'completed', 1);
  `);

  const insertEvent = db.prepare(
    `INSERT INTO "Event" ("seasonId", "name", "slug", "date") VALUES (?, ?, ?, ?)`,
  );
  const eventCounts = new Map([
    [1, 5],
    [2, 7],
    [3, 2],
    [4, 6],
    [5, 11],
    [6, 10],
  ]);
  for (const [seasonId, count] of eventCounts) {
    for (let i = 1; i <= count; i += 1) {
      const date = `20${String(20 + seasonId).padStart(2, "0")}-05-${String(i).padStart(2, "0")}`;
      insertEvent.run(seasonId, `Event ${seasonId}-${i}`, `event-${seasonId}-${i}`, date);
    }
  }
  // A same-day second session is one combined scoring group, not a sixth
  // scoring event for season 1.
  insertEvent.run(
    1,
    "Event 1-5 Session B",
    "event-1-5-b",
    "2021-05-05T09:00:00.000+00:00",
  );

  db.exec(readFileSync(migrationPath, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function season(id: number) {
  return db
    .prepare(
      `SELECT id, name, plannedEvents, minimumEvents, rulesetId
       FROM "Season" WHERE id = ?`,
    )
    .get(id) as {
    id: number;
    name: string;
    plannedEvents: number;
    minimumEvents: number;
    rulesetId: number;
  };
}

function policy(rulesetId: number): ScoringPolicy {
  const row = db
    .prepare(`SELECT policy FROM "ScoringSystem" WHERE id = ?`)
    .get(rulesetId) as { policy: string };
  return JSON.parse(row.policy) as ScoringPolicy;
}

describe("ruleset scoring-parameter migration", () => {
  it("adds and backfills Season.minimumEvents from each season's prior effective total", () => {
    expect(season(1).minimumEvents).toBe(3); // 5 actual -> floor(5/2)+1
    expect(season(2).minimumEvents).toBe(4); // 7 actual
    expect(season(3).minimumEvents).toBe(4); // planned 6 > 2 actual
    expect(season(4).minimumEvents).toBe(6); // planned 10 > 6 actual
    expect(season(5).minimumEvents).toBe(6); // 11 actual
    expect(season(6).minimumEvents).toBe(6); // 10 actual
    expect(season(7).minimumEvents).toBe(4); // no basis to infer; use the new-season default
    expect(season(8).minimumEvents).toBe(4); // planned 7, no events
  });

  it("keeps the original ruleset id for the active season's drop count", () => {
    expect(season(3).rulesetId).toBe(1);
    expect(policy(1)).toEqual({
      v: 3,
      dropCount: 2,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
    });

    expect(season(4).rulesetId).toBe(2);
    expect(policy(2)).toEqual({
      v: 3,
      dropCount: 4,
      dropTiming: "proportional",
      paxSection: true,
      conePenaltyMs: 1500,
    });
  });

  it("reuses the original ruleset for other seasons with the same prior drop count", () => {
    expect(season(1).rulesetId).toBe(1); // total 5 -> 2 drops, same as active PCA season
    expect(season(6).rulesetId).toBe(2); // total 10 -> 4 drops, same as active RMsolo season
  });

  it("clones one ruleset per distinct non-canonical drop count and reassigns matching seasons", () => {
    expect(season(2).rulesetId).not.toBe(1); // total 7 -> 3 drops
    expect(season(8).rulesetId).toBe(season(2).rulesetId); // same old ruleset + drop count
    expect(policy(season(2).rulesetId)).toMatchObject({
      v: 3,
      dropCount: 3,
      dropTiming: "fixed",
    });

    expect(season(5).rulesetId).not.toBe(2); // total 11 -> 5 drops
    expect(policy(season(5).rulesetId)).toMatchObject({
      v: 3,
      dropCount: 5,
      dropTiming: "proportional",
    });

    expect(season(7).rulesetId).toBe(1); // empty season uses the safe two-drop default
    expect(policy(season(7).rulesetId)).toMatchObject({
      v: 3,
      dropCount: 2,
      dropTiming: "fixed",
    });
  });

  it("uses a collision-free name when a generated clone name already exists", () => {
    expect(
      db
        .prepare(`SELECT name FROM "ScoringSystem" WHERE id = ?`)
        .get(season(2).rulesetId),
    ).toEqual({ name: "PCA Classic [v3-5]-1" });
  });

  it("canonicalizes unassigned rulesets to safe editable v3 defaults", () => {
    expect(policy(3)).toEqual({
      v: 3,
      dropCount: 2,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
    });
  });

  it("preserves season rows, event rows, policy fields, and PAX tables", () => {
    expect(db.prepare(`SELECT COUNT(*) c FROM "Season"`).get()).toEqual({ c: 8 });
    expect(db.prepare(`SELECT COUNT(*) c FROM "Event"`).get()).toEqual({ c: 42 });
    expect(
      db.prepare(`SELECT paxTable FROM "ScoringSystem" WHERE id = 1`).get(),
    ).toEqual({ paxTable: '{"C1":1}' });
    expect(
      db.prepare(`SELECT paxTable FROM "ScoringSystem" WHERE id = 2`).get(),
    ).toEqual({ paxTable: '{"AS":0.83}' });
  });

  it("removes helper tables and leaves foreign-key integrity clean", () => {
    const helperTables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE '_ScoringPolicyV3%'`,
      )
      .all();
    expect(helperTables).toEqual([]);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });
});
