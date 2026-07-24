-- Decouple the two meanings previously hidden behind floor(N/2)+1:
--   * Season.minimumEvents controls championship eligibility.
--   * ScoringPolicy v3 dropCount controls how many scores are discarded.
-- v2's fixed/proportional `drops` value is retained as v3 `dropTiming`.
--
-- Existing standings must not change. The effective season size before this
-- migration was max(plannedEvents, distinct scoring dates). Each season is
-- backfilled from that size. When one v2 ruleset is shared by seasons whose
-- sizes imply different drop counts, the active/latest season keeps the
-- original ruleset id and one clone is created per other distinct drop count.
-- Empty, unplanned seasons have no prior size to infer from, so they receive
-- the same 4-event minimum and 2-drop defaults as a newly created season.

ALTER TABLE "Season"
  ADD COLUMN "minimumEvents" INTEGER NOT NULL DEFAULT 4;

CREATE TABLE "_ScoringPolicyV3Season" (
  "seasonId" INTEGER NOT NULL PRIMARY KEY,
  "originalRulesetId" INTEGER NOT NULL,
  "dropCount" INTEGER NOT NULL,
  "minimumEvents" INTEGER NOT NULL
);

INSERT INTO "_ScoringPolicyV3Season"
  ("seasonId", "originalRulesetId", "dropCount", "minimumEvents")
WITH "SeasonTotals" AS (
  SELECT
    s."id" AS "seasonId",
    s."rulesetId" AS "originalRulesetId",
    MAX(s."plannedEvents", COUNT(DISTINCT date(e."date"))) AS "totalEvents"
  FROM "Season" s
  LEFT JOIN "Event" e ON e."seasonId" = s."id"
  GROUP BY s."id", s."rulesetId", s."plannedEvents"
)
SELECT
  "seasonId",
  "originalRulesetId",
  CASE
    WHEN "totalEvents" = 0 THEN 2
    ELSE "totalEvents" - (CAST("totalEvents" / 2 AS INTEGER) + 1)
  END,
  CASE
    WHEN "totalEvents" = 0 THEN 4
    ELSE CAST("totalEvents" / 2 AS INTEGER) + 1
  END
FROM "SeasonTotals";

UPDATE "Season"
SET "minimumEvents" = (
  SELECT m."minimumEvents"
  FROM "_ScoringPolicyV3Season" m
  WHERE m."seasonId" = "Season"."id"
);

-- Choose which effective drop count keeps each original ruleset id. Prefer
-- an active season, then the newest year/id, matching the operator's current
-- configuration rather than a historical season.
CREATE TABLE "_ScoringPolicyV3Original" (
  "rulesetId" INTEGER NOT NULL PRIMARY KEY,
  "dropCount" INTEGER NOT NULL
);

INSERT INTO "_ScoringPolicyV3Original" ("rulesetId", "dropCount")
SELECT "originalRulesetId", "dropCount"
FROM (
  SELECT
    m."originalRulesetId",
    m."dropCount",
    ROW_NUMBER() OVER (
      PARTITION BY m."originalRulesetId"
      ORDER BY
        CASE WHEN s."status" = 'active' THEN 0 ELSE 1 END,
        s."year" DESC,
        s."id" DESC
    ) AS "preference"
  FROM "_ScoringPolicyV3Season" m
  JOIN "Season" s ON s."id" = m."seasonId"
)
WHERE "preference" = 1;

CREATE TABLE "_ScoringPolicyV3Variant" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "originalRulesetId" INTEGER NOT NULL,
  "dropCount" INTEGER NOT NULL,
  "targetRulesetId" INTEGER,
  UNIQUE ("originalRulesetId", "dropCount")
);

INSERT INTO "_ScoringPolicyV3Variant" ("originalRulesetId", "dropCount")
SELECT DISTINCT "originalRulesetId", "dropCount"
FROM "_ScoringPolicyV3Season"
ORDER BY "originalRulesetId", "dropCount";

UPDATE "_ScoringPolicyV3Variant"
SET "targetRulesetId" = "originalRulesetId"
WHERE "dropCount" = (
  SELECT o."dropCount"
  FROM "_ScoringPolicyV3Original" o
  WHERE o."rulesetId" = "_ScoringPolicyV3Variant"."originalRulesetId"
);

CREATE TABLE "_ScoringPolicyV3IdBase" (
  "maxRulesetId" INTEGER NOT NULL
);

INSERT INTO "_ScoringPolicyV3IdBase" ("maxRulesetId")
SELECT COALESCE(MAX("id"), 0) FROM "ScoringSystem";

UPDATE "_ScoringPolicyV3Variant"
SET "targetRulesetId" =
  (SELECT "maxRulesetId" FROM "_ScoringPolicyV3IdBase") + "id"
WHERE "targetRulesetId" IS NULL;

-- Clone before canonicalizing the originals so `$.drops` is still present.
-- Explicit ids make the Season -> variant mapping deterministic.
-- An administrator may already have created a ruleset whose name matches the
-- generated base name. Walk numbered suffixes and take the first league-local
-- name that is not already in use so that uniqueness cannot abort deployment.
WITH RECURSIVE "CloneNameCandidates" AS (
  SELECT
    v."targetRulesetId",
    ss."leagueId",
    ss."name" || ' [v3-' || v."targetRulesetId" || ']' AS "baseName",
    ss."name" || ' [v3-' || v."targetRulesetId" || ']' AS "candidateName",
    0 AS "suffix"
  FROM "_ScoringPolicyV3Variant" v
  JOIN "ScoringSystem" ss ON ss."id" = v."originalRulesetId"
  WHERE v."targetRulesetId" <> v."originalRulesetId"

  UNION ALL

  SELECT
    c."targetRulesetId",
    c."leagueId",
    c."baseName",
    c."baseName" || '-' || (c."suffix" + 1),
    c."suffix" + 1
  FROM "CloneNameCandidates" c
  WHERE EXISTS (
    SELECT 1
    FROM "ScoringSystem" existing
    WHERE existing."leagueId" = c."leagueId"
      AND existing."name" = c."candidateName"
  )
),
"CloneNames" AS (
  SELECT c."targetRulesetId", c."candidateName"
  FROM "CloneNameCandidates" c
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ScoringSystem" existing
    WHERE existing."leagueId" = c."leagueId"
      AND existing."name" = c."candidateName"
  )
)
INSERT INTO "ScoringSystem"
  ("id", "leagueId", "name", "policy", "paxTable", "createdAt")
SELECT
  v."targetRulesetId",
  ss."leagueId",
  names."candidateName",
  json_set(
    json_remove(ss."policy", '$.drops'),
    '$.v', 3,
    '$.dropCount', v."dropCount",
    '$.dropTiming', json_extract(ss."policy", '$.drops')
  ),
  ss."paxTable",
  ss."createdAt"
FROM "_ScoringPolicyV3Variant" v
JOIN "ScoringSystem" ss ON ss."id" = v."originalRulesetId"
JOIN "CloneNames" names ON names."targetRulesetId" = v."targetRulesetId"
WHERE v."targetRulesetId" <> v."originalRulesetId";

UPDATE "Season"
SET "rulesetId" = (
  SELECT v."targetRulesetId"
  FROM "_ScoringPolicyV3Season" m
  JOIN "_ScoringPolicyV3Variant" v
    ON v."originalRulesetId" = m."originalRulesetId"
   AND v."dropCount" = m."dropCount"
  WHERE m."seasonId" = "Season"."id"
);

-- Assigned originals take the active/latest season's preserved drop count.
UPDATE "ScoringSystem"
SET "policy" = json_set(
  json_remove("policy", '$.drops'),
  '$.v', 3,
  '$.dropCount', (
    SELECT o."dropCount"
    FROM "_ScoringPolicyV3Original" o
    WHERE o."rulesetId" = "ScoringSystem"."id"
  ),
  '$.dropTiming', json_extract("policy", '$.drops')
)
WHERE "id" IN (SELECT "rulesetId" FROM "_ScoringPolicyV3Original");

-- An unassigned v2 ruleset has no season size from which to infer a count.
-- Give only pre-migration, unassigned rows the PCA-shaped editable default.
UPDATE "ScoringSystem"
SET "policy" = json_set(
  json_remove("policy", '$.drops'),
  '$.v', 3,
  '$.dropCount', 2,
  '$.dropTiming', json_extract("policy", '$.drops')
)
WHERE "id" <= (SELECT "maxRulesetId" FROM "_ScoringPolicyV3IdBase")
  AND "id" NOT IN (SELECT "rulesetId" FROM "_ScoringPolicyV3Original");

DROP TABLE "_ScoringPolicyV3IdBase";
DROP TABLE "_ScoringPolicyV3Variant";
DROP TABLE "_ScoringPolicyV3Original";
DROP TABLE "_ScoringPolicyV3Season";
