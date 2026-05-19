-- M1.5a: rename Driver.lastName -> Driver.lastInitial
-- Uses ALTER TABLE ... RENAME COLUMN (requires SQLite 3.25+; Prisma shadows this as a table rebuild on some
-- providers, but we write the rename directly so existing rows survive and FK references on Entry/Video are
-- preserved without a drop/recreate cycle.
ALTER TABLE "Driver" RENAME COLUMN "lastName" TO "lastInitial";
