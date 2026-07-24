import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The 20260725010000_ruleset_centric_scoring migration moves scoring off the
// Season row and onto ScoringSystem ("ruleset"): ScoringSystem gains a
// COMPLETE paxTable (seeded from the built-in RMSOLO_PAX_2026 table merged
// with each season's overrides), every Season is pointed at a ruleset whose
// (policy, paxTable) matches what the season carried, and the Season table is
// rebuilt WITHOUT its scoringPolicy/paxTable snapshot columns and WITH a
// required rulesetId FK (ON DELETE RESTRICT).
//
// Following the entry-pax-applied-migration.test.ts precedent, this executes
// the migration's real SQL file against a hand-built pre-migration schema:
// League as left by 20260723020000_league_logo_url, ScoringSystem as created
// by 20260722020000_league_foundation, Season as rebuilt by
// 20260723010000_season_slug — all with policies already canonicalized to v2
// by 20260724030000_scoring_policy_v2 (one deliberately-v1 season row is
// seeded anyway, to prove the migration's json transforms stay robust on
// that shape).
//
// Season table rebuilds are the 2026-07-23 incident pattern (a transaction-
// wrapped PRAGMA foreign_keys=OFF is a no-op and cascades can wipe child
// rows) — so this test also asserts row preservation and a clean
// PRAGMA foreign_key_check with FKs re-enabled.

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260725010000_ruleset_centric_scoring/migration.sql",
);

const P_PCA = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';
const P_PCA_V1 = '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';
const P_RMSOLO = '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":2000}';
const P_OTHER = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":1500}';

const tmpDir = mkdtempSync(join(tmpdir(), "ruleset-centric-migration-test-"));
const dbPath = join(tmpDir, "pre-migration.db");
let db: Database.Database;

beforeAll(() => {
  db = new Database(dbPath);
  // The migration file manages FK pragmas itself (defer_foreign_keys=ON +
  // foreign_keys=OFF around the rebuild, both restored at the end).
  db.exec(`
    CREATE TABLE "League" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "siteTitle" TEXT NOT NULL,
        "siteDescription" TEXT NOT NULL,
        "footerText" TEXT,
        "landingDescription" TEXT NOT NULL,
        "accessGate" TEXT NOT NULL DEFAULT 'required',
        "msrOrgId" TEXT,
        "smugmugUser" TEXT,
        "smugmugDisciplinePath" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "logoUrl" TEXT
    );
    CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");

    CREATE TABLE "ScoringSystem" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "policy" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ScoringSystem_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "ScoringSystem_leagueId_name_key" ON "ScoringSystem"("leagueId", "name");

    CREATE TABLE "Season" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "year" INTEGER NOT NULL,
        "plannedEvents" INTEGER NOT NULL DEFAULT 0,
        "scoringPolicy" TEXT NOT NULL,
        "paxTable" TEXT NOT NULL DEFAULT '{}',
        "status" TEXT NOT NULL DEFAULT 'active',
        CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    CREATE INDEX "Season_leagueId_year_idx" ON "Season"("leagueId", "year");
    CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");
    CREATE UNIQUE INDEX "Season_leagueId_slug_key" ON "Season"("leagueId", "slug");
  `);

  const insertLeague = db.prepare(
    `INSERT INTO "League" ("id","slug","name","siteTitle","siteDescription","landingDescription") VALUES (?,?,?,?,?,?)`,
  );
  insertLeague.run(1, "alpha", "Alpha", "t", "d", "l");
  insertLeague.run(2, "beta", "Beta", "t", "d", "l");

  const insertPreset = db.prepare(
    `INSERT INTO "ScoringSystem" ("id","leagueId","name","policy") VALUES (?,?,?,?)`,
  );
  insertPreset.run(1, 1, "PCA Classic", P_PCA);
  insertPreset.run(2, 2, "RMsolo Standard", P_RMSOLO);
  // Deliberate name-collision target: the generated name for league 2's
  // "2026 Cup" season would be "2026 Cup rules".
  insertPreset.run(3, 2, "2026 Cup rules", P_OTHER);

  const insertSeason = db.prepare(
    `INSERT INTO "Season" ("id","leagueId","name","slug","year","plannedEvents","scoringPolicy","paxTable","status") VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  // League 1: two seasons sharing the preset policy (one still v1-shaped) → both reuse preset 1.
  insertSeason.run(1, 1, "2025 Season", "2025-season", 2025, 6, P_PCA, "{}", "completed");
  insertSeason.run(2, 1, "2026 Season", "2026-season", 2026, 6, P_PCA_V1, "{}", "active");
  // League 1: paxTable override → new ruleset with the override merged over the built-in table.
  insertSeason.run(3, 1, "2026 Winter", "2026-winter", 2026, 0, P_PCA, '{"AS":0.5,"ZZZ":0.9}', "active");
  // League 2: matches its own league's preset → reuse preset 2 (not preset 1).
  insertSeason.run(4, 2, "2026 Season", "2026-season", 2026, 0, P_RMSOLO, "{}", "active");
  // League 2: policy matches league 1's preset but NOT any league-2 ruleset →
  // must create a new league-2 ruleset (league-scoped matching), and its
  // generated name collides with preset 3 → collision guard appends " #<id>".
  insertSeason.run(5, 2, "2026 Cup", "2026-cup", 2026, 0, P_PCA, "{}", "active");
  // League 1: same (policy, paxTable) as season 3 → must SHARE season 3's new
  // ruleset, not mint a duplicate.
  insertSeason.run(6, 1, "2027 Season", "2027-season", 2027, 0, P_PCA, '{"AS":0.5,"ZZZ":0.9}', "active");

  db.exec(readFileSync(MIGRATION_SQL_PATH, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type SeasonRow = { id: number; leagueId: number; rulesetId: number };
type SeasonFullRow = { id: number; slug: string; status: string };
type RulesetRow = { id: number; leagueId: number; name: string; policy: string; paxTable: string };

function season(id: number): SeasonRow {
  return db
    .prepare(`SELECT id, leagueId, rulesetId FROM "Season" WHERE id = ?`)
    .get(id) as SeasonRow;
}

function seasonFull(id: number): SeasonFullRow {
  return db
    .prepare(`SELECT id, slug, status FROM "Season" WHERE id = ?`)
    .get(id) as SeasonFullRow;
}

function ruleset(id: number): RulesetRow {
  return db
    .prepare(`SELECT id, leagueId, name, policy, paxTable FROM "ScoringSystem" WHERE id = ?`)
    .get(id) as RulesetRow;
}

describe("20260725010000_ruleset_centric_scoring migration", () => {
  it("preserves every Season row and drops the snapshot columns", () => {
    expect(db.prepare(`SELECT COUNT(*) c FROM "Season"`).get()).toEqual({ c: 6 });
    const cols = (db.prepare(`PRAGMA table_info("Season")`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).not.toContain("scoringPolicy");
    expect(cols).not.toContain("paxTable");
    expect(cols).toContain("rulesetId");
  });

  it("keeps a rebuilt season's non-key columns (slug, status) intact", () => {
    // Season 1 was inserted "completed" with slug "2025-season"; season 4
    // was inserted "active" with slug "2026-season" (a different league,
    // guarding against a leagueId mixup in the rebuild's column carry-over).
    expect(seasonFull(1)).toEqual({ id: 1, slug: "2025-season", status: "completed" });
    expect(seasonFull(4)).toEqual({ id: 4, slug: "2026-season", status: "active" });
  });

  it("seeds every pre-existing ScoringSystem row's paxTable with the complete built-in table", () => {
    for (const id of [1, 2, 3]) {
      const r = ruleset(id);
      const table = JSON.parse(r.paxTable) as Record<string, number>;
      expect(table.CS).toBe(0.814);
      expect(table.AM).toBe(1);
      expect(Object.keys(table).length).toBe(35);
    }
  });

  it("points seasons sharing a preset-matching policy at the SAME existing ruleset (v1 shape transformed)", () => {
    expect(season(1).rulesetId).toBe(1);
    expect(season(2).rulesetId).toBe(1); // v1-shaped stored policy canonicalized before matching
  });

  it("creates ONE new ruleset for the two seasons sharing a paxTable override, with the override merged over the built-in table", () => {
    const s3 = season(3);
    const s6 = season(6);
    expect(s3.rulesetId).toBe(s6.rulesetId);
    expect(s3.rulesetId).not.toBe(1);
    const r = ruleset(s3.rulesetId);
    expect(r.leagueId).toBe(1);
    expect(r.name).toBe("2026 Winter rules");
    const table = JSON.parse(r.paxTable) as Record<string, number>;
    expect(table.AS).toBe(0.5); // season override wins
    expect(table.ZZZ).toBe(0.9); // novel code kept
    expect(table.CS).toBe(0.814); // built-in entries retained
    expect(JSON.parse(r.policy)).toEqual({
      v: 2,
      drops: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
    });
    // Exactly one ruleset carries this name — no duplicate mint for season 6.
    expect(
      db
        .prepare(`SELECT COUNT(*) c FROM "ScoringSystem" WHERE leagueId = 1 AND name LIKE '2026 Winter rules%'`)
        .get(),
    ).toEqual({ c: 1 });
  });

  it("matches rulesets league-scoped and guards generated-name collisions with a ' #<seasonId>' suffix", () => {
    expect(season(4).rulesetId).toBe(2);
    const s5 = season(5);
    const r = ruleset(s5.rulesetId);
    expect(r.leagueId).toBe(2);
    expect(s5.rulesetId).not.toBe(1); // league-1 preset with identical policy must NOT be reused
    expect(s5.rulesetId).not.toBe(3); // colliding-name preset has a different policy
    expect(r.name).toBe("2026 Cup rules #5");
    expect(JSON.parse(r.policy)).toEqual({
      v: 2,
      drops: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
    });
  });

  it("canonicalizes every stored policy to v2 with no classMetric key", () => {
    const rows = db.prepare(`SELECT policy FROM "ScoringSystem"`).all() as { policy: string }[];
    for (const { policy } of rows) {
      const parsed = JSON.parse(policy) as Record<string, unknown>;
      expect(parsed.v).toBe(2);
      expect(parsed).not.toHaveProperty("classMetric");
    }
  });

  it("recreates the Season indexes and the RESTRICT FKs", () => {
    const indexes = (db.prepare(`PRAGMA index_list("Season")`).all() as { name: string }[]).map(
      (i) => i.name,
    );
    expect(indexes).toContain("Season_leagueId_year_idx");
    expect(indexes).toContain("Season_leagueId_name_key");
    expect(indexes).toContain("Season_leagueId_slug_key");
    const fks = db.prepare(`PRAGMA foreign_key_list("Season")`).all() as {
      table: string;
      on_delete: string;
    }[];
    const targets = fks.map((f) => `${f.table}:${f.on_delete}`).sort();
    expect(targets).toEqual(["League:RESTRICT", "ScoringSystem:RESTRICT"]);
  });

  it("leaves foreign keys enabled and PRAGMA foreign_key_check clean", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });
});
