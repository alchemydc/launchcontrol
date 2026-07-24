-- League.logoUrl: optional http(s) URL to a league's logo image, rendered on
-- the league gate card grid (see docs/superpowers/specs — league gate). Plain
-- nullable ADD COLUMN — no backfill needed, no table rebuild required.
ALTER TABLE "League" ADD COLUMN "logoUrl" TEXT;
