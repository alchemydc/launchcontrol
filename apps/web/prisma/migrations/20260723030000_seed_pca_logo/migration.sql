-- Seed the default PCA RMR league's gate-card logo.
--
-- `20260723020000_league_logo_url` added the nullable `League.logoUrl` column;
-- `20260722020000_league_foundation` seeded the pca-rmr row without a logo, so
-- its gate card falls back to the initials placeholder. Point it at the bundled
-- crest (public/league-pca-rmr.jpg), served same-origin so it resolves on every
-- deployment (staging + prod) without an external host.
--
-- Guarded on `logoUrl IS NULL` so it never clobbers an operator-set value.
UPDATE "League" SET "logoUrl" = '/league-pca-rmr.jpg' WHERE "slug" = 'pca-rmr' AND "logoUrl" IS NULL;
