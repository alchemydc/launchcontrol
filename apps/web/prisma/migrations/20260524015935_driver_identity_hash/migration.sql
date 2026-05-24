/*
  Warnings:

  - Added the required column `identityHash` to the `Driver` table without a default value. This is not possible if the table is not empty.

*/
-- NOTE: This migration assumes an empty Driver table. The required NOT NULL
-- `identityHash` column has no default and no backfill, so a non-empty
-- `Driver` table will fail this migration. The intended upgrade path is to
-- drop + re-ingest (`pnpm --filter web migrate:turso` then re-run ingest);
-- see PRD §M1.10.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Driver" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "msrUid" TEXT,
    "firstName" TEXT NOT NULL,
    "lastInitial" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "memberNum" TEXT
);
INSERT INTO "new_Driver" ("firstName", "id", "lastInitial", "memberNum", "msrUid") SELECT "firstName", "id", "lastInitial", "memberNum", "msrUid" FROM "Driver";
DROP TABLE "Driver";
ALTER TABLE "new_Driver" RENAME TO "Driver";
CREATE UNIQUE INDEX "Driver_msrUid_key" ON "Driver"("msrUid");
CREATE UNIQUE INDEX "Driver_identityHash_key" ON "Driver"("identityHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
