-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "lastName" TEXT;

-- RenameColumn (data-preserving; do not replace with drop+add)
ALTER TABLE "Event" RENAME COLUMN "axdbSha256" TO "sourceSha256";
