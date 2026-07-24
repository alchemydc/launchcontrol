-- SuperUser: global role table. ADMIN_MSR_UIDS env remains the irrevocable bootstrap;
-- this table holds UI-granted superusers. Deliberately NOT backfilled from env
-- (matches LeagueMembership precedent: env is config, rows are data).
CREATE TABLE "SuperUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "msrUid" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SuperUser_msrUid_key" ON "SuperUser"("msrUid");
