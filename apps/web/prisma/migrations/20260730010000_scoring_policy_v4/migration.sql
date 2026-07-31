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
-- here. This is purely behavior-preserving: ratio1000/class IS the formula
-- those rows were already scored with, so no standing moves as a result of
-- running this migration.
--
-- Deliberately NO tenant-specific statement. An earlier draft also flipped the
-- rmsolo league's rulesets to the event-wide basis by matching League.slug.
-- That is redundant now that the ruleset admin UI carries a Points system
-- control: moving a league to the event-wide basis is a visible, audited admin
-- action rather than a slug match that silently does nothing if the slug ever
-- differs. It also keeps tenant identity out of migrations, matching the
-- repo's no-hardcoded-org rule.
--
-- The json_valid() guard is not decoration: json_extract() raises "malformed
-- JSON" on a row whose policy text isn't valid JSON, which would abort this
-- whole statement. The app already treats an unparseable policy as a survivable
-- data state (preset-dialog.tsx's `preset.policy === null` branch, presets-
-- table.tsx's em-dash cell), so such a row must not be able to block the
-- migration for every other league. A skipped row is no worse off than before:
-- it could not be parsed then either, and the ruleset editor rewrites it in
-- canonical form on the next save.
UPDATE "ScoringSystem"
SET "policy" = json_set(
      "policy",
      '$.v', 4,
      '$.points', json('{"type":"ratio1000","basis":"class"}')
    )
WHERE json_valid("policy") AND json_extract("policy", '$.v') = 3;
