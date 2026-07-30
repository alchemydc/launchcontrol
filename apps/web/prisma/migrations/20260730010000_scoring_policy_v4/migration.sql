-- Scoring policy v4: the per-event points formula becomes policy data.
--
-- Until now every class section was scored with the PCA formula
-- round(1000 * fastest_in_class / driver_best), so each class winner earned a
-- fresh 1000. That is correct for PCA and wrong for RMsolo, whose published
-- supplemental rules reference the EVENT's fastest indexed time across all
-- classes, giving each driver exactly one score per event.
--
-- App code (parseScoringPolicy) now rejects any stored policy whose "v" isn't
-- 4 and requires a "points" block, so every stored v3 policy is canonicalized
-- here. The first statement is purely behavior-preserving: ratio1000/class IS
-- the formula those rows were already scored with.
UPDATE "ScoringSystem"
SET "policy" = json_set(
      "policy",
      '$.v', 4,
      '$.points', json('{"type":"ratio1000","basis":"class"}')
    )
WHERE json_extract("policy", '$.v') = 3;

-- RMsolo's rulesets move to the event-wide reference. Targeting is by League
-- slug because rulesets are created at runtime (league:create), so no seeded
-- row exists for this migration to name. This is a point-in-time data fix, not
-- live code, and it is a silent no-op on any database without an 'rmsolo'
-- league — which covers local dev and the PCA-only production DB.
UPDATE "ScoringSystem"
SET "policy" = json_set(
      "policy",
      '$.points', json('{"type":"ratio1000","basis":"event"}')
    )
WHERE json_extract("policy", '$.v') = 4
  AND "leagueId" IN (SELECT "id" FROM "League" WHERE "slug" = 'rmsolo');
