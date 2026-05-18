-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "msrEventId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "location" TEXT,
    "axdbSha256" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "msrUid" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "memberNum" TEXT
);

-- CreateTable
CREATE TABLE "CarClass" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "paxIndex" DECIMAL NOT NULL DEFAULT 1.0000
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "paxClassId" INTEGER NOT NULL,
    "carNumber" TEXT NOT NULL,
    "carDescription" TEXT,
    CONSTRAINT "Entry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CarClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Entry_paxClassId_fkey" FOREIGN KEY ("paxClassId") REFERENCES "CarClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "rawTimeMs" INTEGER,
    "cones" INTEGER NOT NULL DEFAULT 0,
    "disposition" TEXT NOT NULL DEFAULT 'CLEAN',
    CONSTRAINT "Run_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Video" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "runGroup" TEXT,
    "carClass" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Video_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Video_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_msrEventId_key" ON "Event"("msrEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_msrUid_key" ON "Driver"("msrUid");

-- CreateIndex
CREATE UNIQUE INDEX "CarClass_code_key" ON "CarClass"("code");

-- CreateIndex
CREATE INDEX "Entry_eventId_idx" ON "Entry"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_eventId_driverId_key" ON "Entry"("eventId", "driverId");

-- CreateIndex
CREATE INDEX "Run_entryId_idx" ON "Run"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Run_entryId_runNumber_key" ON "Run"("entryId", "runNumber");

-- CreateIndex
CREATE INDEX "Video_eventId_idx" ON "Video"("eventId");
