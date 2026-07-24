-- Scoring policy v2 (Task R1): the per-policy raw/pax class-ranking toggle
-- ("classMetric") is retired — every class now ranks unconditionally on
-- Math.round(best * appliedPaxIndex(entry)) (see season-leaderboard.ts and
-- scoring-policy.ts). App code (parseScoringPolicy) now rejects any stored
-- policy whose "v" isn't 2, so every existing v1 policy JSON string —
-- ScoringSystem.policy and Season.scoringPolicy, both seeded by the
-- league-foundation migration — must be canonicalized here: drop the
-- "classMetric" key and bump "v" to 2. This is a pure JSON-shape change, not
-- a scoring-behavior change — a class where every entry shares one PAX
-- factor produces identical order and points either way (see the comment on
-- ScoringPolicy in scoring-policy.ts), so no stored numeric factor is
-- touched here, only the policy envelope.
UPDATE "ScoringSystem"
SET "policy" = json_set(json_remove("policy", '$.classMetric'), '$.v', 2)
WHERE json_extract("policy", '$.v') = 1;

UPDATE "Season"
SET "scoringPolicy" = json_set(json_remove("scoringPolicy", '$.classMetric'), '$.v', 2)
WHERE json_extract("scoringPolicy", '$.v') = 1;
