import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slugify } from "@/lib/ingest";

// The 20260723010000_season_slug migration hand-rebuilds Season to add a
// required `slug` column, backfilling it for whatever rows already exist via
// a SQL approximation of ingest.ts's `slugify()` (see the migration's header
// comment for the exact charset it maps to '-' and its documented limits).
// Rather than reconstructing the full pre-migration schema via a separate
// `prisma migrate deploy` run (racy: it would need to temporarily hide this
// migration's directory from the shared prisma/migrations tree that every
// other DB-backed test file's `migrate deploy` also reads from), this test
// executes the migration's actual SQL file directly against a hand-built
// "pre-migration-shaped" Season table — the same table shape the prior
// migration (league_foundation) leaves behind — seeded with a variety of
// pre-existing season names, and asserts the resulting slugs.

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260723010000_season_slug/migration.sql",
);

const tmpDir = mkdtempSync(join(tmpdir(), "season-slug-migration-test-"));
const dbPath = join(tmpDir, "pre-migration.db");
let db: Database.Database;

// Names covering the migration's documented punctuation charset (space,
// underscore, apostrophe, period, ampersand, slash) plus a pre-existing
// hyphen and a run of consecutive non-alnum characters — every one of these
// is expected to backfill to exactly what `slugify()` would produce, proving
// the SQL approximation matches the TS source of truth for realistic names.
const SEASON_NAMES = [
  "2026 Season",
  "Winter Series",
  "2025-2026 Winter Series",
  "Bob's Season",
  "Foo - Bar",
  "A/B & C.D_E Season",
] as const;

beforeAll(() => {
  db = new Database(dbPath);
  // Mirrors the Season/League shape left behind by the league_foundation
  // migration (prisma/migrations/20260722020000_league_foundation/migration.sql)
  // — i.e. the schema state immediately before this migration runs.
  db.exec(`
    CREATE TABLE "League" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "slug" TEXT NOT NULL
    );
    CREATE TABLE "Season" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "leagueId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "year" INTEGER NOT NULL,
      "plannedEvents" INTEGER NOT NULL DEFAULT 0,
      "scoringPolicy" TEXT NOT NULL,
      "paxTable" TEXT NOT NULL DEFAULT '{}',
      "status" TEXT NOT NULL DEFAULT 'active',
      CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id")
    );
    INSERT INTO "League" ("id", "slug") VALUES (1, 'pca-rmr');
  `);
  const insertSeason = db.prepare(
    `INSERT INTO "Season" ("leagueId", "name", "year", "scoringPolicy") VALUES (1, ?, ?, '{}')`,
  );
  SEASON_NAMES.forEach((name, i) => insertSeason.run(name, 2020 + i));

  db.exec(readFileSync(MIGRATION_SQL_PATH, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("20260723010000_season_slug migration backfill", () => {
  it("backfills every pre-existing Season row's slug, matching the TS slugify() source of truth", () => {
    const rows = db
      .prepare(`SELECT "id", "name", "slug" FROM "Season" ORDER BY "id"`)
      .all() as Array<{ id: number; name: string; slug: string }>;

    expect(rows).toHaveLength(SEASON_NAMES.length);
    for (const row of rows) {
      expect(row.slug).toBe(slugify(row.name));
    }

    // Pin the literal values too, so a change to either slugify implementation
    // is caught explicitly rather than only via the cross-check above.
    expect(rows.map((r) => r.slug)).toEqual([
      "2026-season",
      "winter-series",
      "2025-2026-winter-series",
      "bob-s-season",
      "foo-bar",
      "a-b-c-d-e-season",
    ]);
  });

  it("never produces a null or empty slug", () => {
    const rows = db.prepare(`SELECT "slug" FROM "Season"`).all() as Array<{ slug: string }>;
    for (const row of rows) {
      expect(row.slug).toBeTruthy();
    }
  });

  it("enforces slug uniqueness per league post-migration", () => {
    const existing = db.prepare(`SELECT "slug" FROM "Season" LIMIT 1`).get() as { slug: string };
    expect(() =>
      db
        .prepare(
          `INSERT INTO "Season" ("leagueId", "name", "slug", "year", "scoringPolicy") VALUES (1, 'dup', ?, 2099, '{}')`,
        )
        .run(existing.slug),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("still enforces the pre-existing (leagueId, name) uniqueness", () => {
    const existing = db.prepare(`SELECT "name" FROM "Season" LIMIT 1`).get() as { name: string };
    expect(() =>
      db
        .prepare(
          `INSERT INTO "Season" ("leagueId", "name", "slug", "year", "scoringPolicy") VALUES (1, ?, 'dup-slug', 2098, '{}')`,
        )
        .run(existing.name),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
