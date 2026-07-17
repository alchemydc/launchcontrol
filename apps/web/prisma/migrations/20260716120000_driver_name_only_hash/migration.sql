-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "nameOnlyHash" TEXT;

-- CreateIndex
CREATE INDEX "Driver_nameOnlyHash_idx" ON "Driver"("nameOnlyHash");
