-- Ruleset-centric scoring (Task R2): scoring config moves off the Season row
-- and onto ScoringSystem ("ruleset"). Hand-written (not `prisma migrate dev`)
-- because the Season rebuild must backfill a required rulesetId for every
-- pre-existing row in the same migration that adds it, matching each season's
-- stored (scoringPolicy, paxTable) snapshot to a ruleset — reusing an
-- existing one when the league already has an exact (policy, paxTable) match,
-- minting a new one otherwise.
--
--   1. ScoringSystem gains a COMPLETE paxTable (code -> factor JSON; no
--      built-in fallback at read time from here on). Every existing row's
--      policy is (re-)canonicalized to v2 — an idempotent no-op after
--      20260724030000_scoring_policy_v2, kept for robustness — and its
--      paxTable is seeded with the full built-in RMSOLO_PAX_2026 table
--      (inert for AxWare-sourced leagues, which never read it).
--   2. Seasons whose (v2 policy, effective paxTable) matches no ruleset in
--      their league mint one, named "<season name> rules" (suffixed
--      " #<season id>" if that name is already taken). The effective table
--      is json_patch(built-in, season.paxTable) — override wins, built-in
--      entries retained. Only the lowest-id season of each identical
--      (league, policy, table) group mints; the rest reuse it in step 3.
--   3. Season is table-rebuilt WITHOUT scoringPolicy/paxTable and WITH a
--      required rulesetId FK (ON DELETE RESTRICT — a ruleset can never be
--      dropped out from under a season). The rulesetId subselect repeats the
--      step-2 matching expression with ORDER BY id ASC, so ties land on the
--      oldest matching ruleset deterministically; a season that somehow
--      matches nothing violates NOT NULL and aborts the migration loudly
--      rather than guessing.
--
-- All JSON equality goes through SQLite's json() normalization (whitespace-
-- insensitive). Key ORDER is not normalized — this matching works because
-- every app-side policy write funnels through parseScoringPolicy's canonical
-- key order, and both sides of every paxTable comparison are rendered by the
-- same json_patch(built-in, x) expression.
--
-- The Season rebuild is the 2026-07-23 incident pattern: keep the
-- league_foundation PRAGMA bracketing (defer_foreign_keys=ON +
-- foreign_keys=OFF, restored at the end) so FK cascades can never fire
-- mid-rebuild even when the migration runs inside a transaction.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- 1. ScoringSystem.paxTable + policy canonicalization + built-in seed.
ALTER TABLE "ScoringSystem" ADD COLUMN "paxTable" TEXT NOT NULL DEFAULT '{}';

UPDATE "ScoringSystem" SET
  "policy" = json_set(json_remove("policy", '$.classMetric'), '$.v', 2),
  "paxTable" = json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', '{}');

-- 2. Mint rulesets for seasons with no league-local (policy, paxTable) match.
INSERT INTO "ScoringSystem" ("leagueId", "name", "policy", "paxTable", "createdAt")
SELECT
  s."leagueId",
  CASE WHEN EXISTS (
    SELECT 1 FROM "ScoringSystem" sn
    WHERE sn."leagueId" = s."leagueId" AND sn."name" = s."name" || ' rules'
  )
  THEN s."name" || ' rules #' || s."id"
  ELSE s."name" || ' rules'
  END,
  json_set(json_remove(s."scoringPolicy", '$.classMetric'), '$.v', 2),
  json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', s."paxTable"),
  CURRENT_TIMESTAMP
FROM "Season" s
WHERE NOT EXISTS (
  SELECT 1 FROM "ScoringSystem" ss
  WHERE ss."leagueId" = s."leagueId"
    AND json(ss."policy") = json(json_set(json_remove(s."scoringPolicy", '$.classMetric'), '$.v', 2))
    AND json(ss."paxTable") = json(json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', s."paxTable"))
)
AND NOT EXISTS (
  -- Dedupe within this statement: only the lowest-id season of an identical
  -- (league, policy, effective-table) group mints the shared ruleset.
  SELECT 1 FROM "Season" s2
  WHERE s2."leagueId" = s."leagueId" AND s2."id" < s."id"
    AND json(json_set(json_remove(s2."scoringPolicy", '$.classMetric'), '$.v', 2))
      = json(json_set(json_remove(s."scoringPolicy", '$.classMetric'), '$.v', 2))
    AND json(json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', s2."paxTable"))
      = json(json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', s."paxTable"))
);

-- 3. Rebuild Season: drop scoringPolicy/paxTable, add required rulesetId.
--    Column set, FK actions, and indexes copied from the season_slug rebuild
--    (the latest Season shape) — Season_leagueId_fkey stays ON DELETE RESTRICT.
CREATE TABLE "new_Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plannedEvents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rulesetId" INTEGER NOT NULL,
    CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Season_rulesetId_fkey" FOREIGN KEY ("rulesetId") REFERENCES "ScoringSystem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Season" ("id", "leagueId", "name", "slug", "year", "plannedEvents", "status", "rulesetId")
SELECT
    s."id", s."leagueId", s."name", s."slug", s."year", s."plannedEvents", s."status",
    (SELECT ss."id" FROM "ScoringSystem" ss
     WHERE ss."leagueId" = s."leagueId"
       AND json(ss."policy") = json(json_set(json_remove(s."scoringPolicy", '$.classMetric'), '$.v', 2))
       AND json(ss."paxTable") = json(json_patch('{"SS":0.84,"AS":0.83,"BS":0.823,"CS":0.814,"DS":0.811,"ES":0.788,"FS":0.817,"GS":0.809,"HS":0.78,"SSC":0.808,"AST":0.836,"BST":0.835,"CST":0.829,"DST":0.82,"GST":0.812,"SST":0.838,"CAMC":0.828,"CAMS":0.847,"CAMT":0.819,"XA":0.861,"XB":0.859,"XU":0.872,"FSP":0.833,"FP":0.877,"FM":0.917,"SMF":0.857,"SSM":0.878,"BM":0.966,"AM":1,"CP":0.862,"CSP":0.858,"CSX":0.803,"DM":0.906,"EP":0.865,"EST":0.815}', s."paxTable"))
     ORDER BY ss."id" ASC LIMIT 1)
FROM "Season" s;
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE INDEX "Season_leagueId_year_idx" ON "Season"("leagueId", "year");
CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");
CREATE UNIQUE INDEX "Season_leagueId_slug_key" ON "Season"("leagueId", "slug");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
