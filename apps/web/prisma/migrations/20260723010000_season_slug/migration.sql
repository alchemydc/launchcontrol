-- Season.slug: URL-safe addressing key, unique per league (see docs/superpowers/specs/2026-07-23-league-multiclub-design.md
-- "Season addressing"). Hand-written (not `prisma migrate dev`) because the
-- required column needs a backfilled value for every pre-existing Season row
-- in the same statement that adds it — SQLite requires a table rebuild for
-- that (no ALTER TABLE ... ADD COLUMN with NOT NULL and no default over
-- existing rows). Single table-rebuild, data-preserving, ids preserved.
--
-- Backfill: slug = a SQL approximation of src/lib/ingest.ts's `slugify()`
-- (lowercase; a fixed punctuation set — space, underscore, apostrophe,
-- period, ampersand, slash — mapped to '-'; runs of '-' collapsed; leading/
-- trailing '-' trimmed). This SQL slugify runs exactly once, here, for
-- whatever Season rows already exist at migration time. Every Season created
-- from this point on (create-season CLI, ingest auto-create) is slugified by
-- the single TS source of truth (src/lib/ingest.ts's `slugify`) — this SQL
-- expression is not reused anywhere else.
--
-- LIMITATION: unlike the TS version, this SQL expression only maps the fixed
-- punctuation set above (not "every non [a-z0-9] character") to '-'. Season
-- names in this codebase are either machine-generated ("<year> Season", the
-- ingest/CLI default) or short operator-typed names — both fall inside this
-- set. A name using other punctuation (e.g. parentheses, colons, emoji) would
-- backfill to a slug that still differs from what `slugify()` would produce
-- for that same string, though it will still be a valid, unique slug for this
-- table. Hand-inspect the backfilled `slug` column after migrating a
-- production DB with unusual season names.
--
-- LIMITATION: SQLite's built-in `lower()` only folds ASCII case — a Season
-- name with non-ASCII letters (e.g. accented characters) backfills a slug
-- whose casing diverges from what the TS `slugify()` (locale-aware
-- `.toLowerCase()`) would produce for the same string, on top of the
-- punctuation-set gap above.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Season" (
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
INSERT INTO "new_Season" ("id", "leagueId", "name", "slug", "year", "plannedEvents", "scoringPolicy", "paxTable", "status")
SELECT
    "id",
    "leagueId",
    "name",
    trim(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            lower("name")
                          , ' ', '-')
                        , '_', '-')
                      , '''', '-')
                    , '.', '-')
                  , '/', '-')
                , '&', '-')
              , '--', '-')
            , '--', '-')
          , '--', '-')
        , '--', '-')
    , '-'),
    "year",
    "plannedEvents",
    "scoringPolicy",
    "paxTable",
    "status"
FROM "Season";
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE INDEX "Season_leagueId_year_idx" ON "Season"("leagueId", "year");
CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");
CREATE UNIQUE INDEX "Season_leagueId_slug_key" ON "Season"("leagueId", "slug");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
