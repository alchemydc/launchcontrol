-- PCA PII posture applies to every source (project decision 2026-07-22):
-- full last names are hashed for identity but never stored. Dropping the
-- column also purges any surnames already persisted by the earlier RMsolo
-- ingest behavior.
ALTER TABLE "Driver" DROP COLUMN "lastName";
