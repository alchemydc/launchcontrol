-- PAX snapshot: freeze the factor applied to each entry. Backfill uses the CURRENT
-- live CarClass.paxIndex — pre-existing history is frozen at today's values (the
-- real at-ingest factor is unrecoverable; same caveat as Driver.nameOnlyHash).
ALTER TABLE "Entry" ADD COLUMN "paxIndexApplied" DECIMAL;
UPDATE "Entry" SET "paxIndexApplied" =
  (SELECT "paxIndex" FROM "CarClass" WHERE "CarClass"."id" = "Entry"."paxClassId");
