-- League Foundation: League/ScoringSystem/Season/LeagueMembership + PCA seed & backfill.
--
-- Hand-written (not `prisma migrate dev`): the ordered seed + table rebuilds must run
-- deterministically on every deploy. Order matters:
--   1. create the four new tables
--   2. seed the PCA league + its "PCA Classic" scoring preset
--   3. seed one Season per DISTINCT year present in existing Event rows
--   4. table-rebuild Event to add the required seasonId (backfilled by year) + per-season uniques
--   5. table-rebuild CarClass to add the required leagueId (PCA) + @@unique([leagueId, code])
-- Steps 4-5 use the Prisma SQLite table-rebuild pattern (defer/off FKs, INSERT…SELECT, rename)
-- so no Entry/Video/Run rows are lost and their FKs stay valid (ids are preserved).

-- CreateTable
CREATE TABLE "League" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteTitle" TEXT NOT NULL,
    "siteDescription" TEXT NOT NULL,
    "footerText" TEXT,
    "landingDescription" TEXT NOT NULL,
    "accessGate" TEXT NOT NULL DEFAULT 'required',
    "msrOrgId" TEXT,
    "smugmugUser" TEXT,
    "smugmugDisciplinePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScoringSystem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoringSystem_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plannedEvents" INTEGER NOT NULL DEFAULT 0,
    "scoringPolicy" TEXT NOT NULL,
    "paxTable" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "msrUid" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringSystem_leagueId_name_key" ON "ScoringSystem"("leagueId", "name");

-- CreateIndex
CREATE INDEX "Season_leagueId_year_idx" ON "Season"("leagueId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_msrUid_key" ON "LeagueMembership"("leagueId", "msrUid");

-- Seed: the default PCA RMR league. Branding strings are the production
-- club-config defaults, copied verbatim (upstream-compatibility contract).
-- msrOrgId stays NULL: MSR_ORG_ID env still wins during the config transition (PR 1 Task 3).
INSERT INTO "League" (
    "slug", "name", "siteTitle", "siteDescription", "footerText",
    "landingDescription", "accessGate", "msrOrgId", "smugmugUser", "smugmugDisciplinePath"
) VALUES (
    'pca-rmr',
    'PCA Rocky Mountain Region',
    'Launch Control · PCA RMR',
    'Rocky Mountain Region autocross results, calendar, and community media.',
    'Built for PCA Rocky Mountain Region · Autocross results from VisualAX',
    'Sign in with your MotorsportReg account to access Rocky Mountain Region autocross results, sortable event leaderboards, season standings, and driver profiles.',
    'required',
    NULL,
    'rmrpca',
    'Autocross'
);

-- Seed: the PCA Classic scoring preset (ScoringPolicy v1). Fixed drops, no PAX
-- section, raw class metric, 2000ms cone penalty — the current production behavior.
INSERT INTO "ScoringSystem" ("leagueId", "name", "policy")
SELECT "id", 'PCA Classic', '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}'
FROM "League" WHERE "slug" = 'pca-rmr';

-- Seed: one Season per DISTINCT year in existing Event rows. scoringPolicy is a
-- SNAPSHOT of the PCA Classic policy (literal copy — never a live reference to the
-- ScoringSystem row). plannedEvents mirrors production PLANNED_SEASON_EVENTS (2026 -> 6,
-- all other years -> 0, matching the "fall back to ingested count" behavior). On a fresh
-- (eventless) DB this seeds nothing; ingest auto-creates a bare Season per event year.
INSERT INTO "Season" ("leagueId", "name", "year", "plannedEvents", "scoringPolicy", "paxTable", "status")
SELECT
    (SELECT "id" FROM "League" WHERE "slug" = 'pca-rmr'),
    CAST(y AS TEXT) || ' Season',
    y,
    CASE WHEN y = 2026 THEN 6 ELSE 0 END,
    '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}',
    '{}',
    'active'
FROM (SELECT DISTINCT CAST(strftime('%Y', "date") AS INTEGER) AS y FROM "Event");

-- RedefineTables: rebuild Event (add required seasonId, backfilled by year) and
-- CarClass (add required leagueId = PCA) under deferred FK enforcement.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "msrEventId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "location" TEXT,
    "sourceSha256" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("id", "seasonId", "msrEventId", "slug", "name", "date", "location", "sourceSha256", "createdAt")
SELECT
    e."id",
    s."id",
    e."msrEventId", e."slug", e."name", e."date", e."location", e."sourceSha256", e."createdAt"
FROM "Event" e
JOIN "Season" s
    ON s."year" = CAST(strftime('%Y', e."date") AS INTEGER)
   AND s."leagueId" = (SELECT "id" FROM "League" WHERE "slug" = 'pca-rmr');
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_seasonId_idx" ON "Event"("seasonId");
CREATE UNIQUE INDEX "Event_seasonId_msrEventId_key" ON "Event"("seasonId", "msrEventId");
CREATE UNIQUE INDEX "Event_seasonId_slug_key" ON "Event"("seasonId", "slug");
CREATE UNIQUE INDEX "Event_seasonId_sourceSha256_key" ON "Event"("seasonId", "sourceSha256");

CREATE TABLE "new_CarClass" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "paxIndex" DECIMAL NOT NULL DEFAULT 1.0000,
    CONSTRAINT "CarClass_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CarClass" ("id", "leagueId", "code", "paxIndex")
SELECT
    c."id",
    (SELECT "id" FROM "League" WHERE "slug" = 'pca-rmr'),
    c."code", c."paxIndex"
FROM "CarClass" c;
DROP TABLE "CarClass";
ALTER TABLE "new_CarClass" RENAME TO "CarClass";
CREATE UNIQUE INDEX "CarClass_leagueId_code_key" ON "CarClass"("leagueId", "code");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
