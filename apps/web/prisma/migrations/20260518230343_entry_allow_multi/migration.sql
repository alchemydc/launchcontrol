-- Drop unique constraint on (eventId, driverId); add non-unique index on driverId.
DROP INDEX "Entry_eventId_driverId_key";
CREATE INDEX "Entry_driverId_idx" ON "Entry"("driverId");
