import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScoringPolicy } from "@/lib/scoring-policy";

const migrationPath = resolve(
  __dirname,
  "..",
  "prisma/migrations/20260730010000_scoring_policy_v4/migration.sql",
);
const tmpDir = mkdtempSync(join(tmpdir(), "scoring-policy-v4-"));
const dbPath = join(tmpDir, "migration.db");

let db: Database.Database;

const PCA_V3 =
  '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}';
const RMSOLO_V3 =
  '{"v":3,"dropCount":4,"dropTiming":"proportional","paxSection":true,"conePenaltyMs":2000}';

beforeAll(() => {
  db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE "League" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "slug" TEXT NOT NULL,
      "name" TEXT NOT NULL
    );
    CREATE TABLE "ScoringSystem" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "leagueId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "policy" TEXT NOT NULL,
      "paxTable" TEXT NOT NULL DEFAULT '{}',
      CONSTRAINT "ScoringSystem_leagueId_fkey"
        FOREIGN KEY ("leagueId") REFERENCES "League" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  db.prepare(`INSERT INTO "League" ("id","slug","name") VALUES (1,'pca-rmr','PCA RMR')`).run();
  db.prepare(`INSERT INTO "League" ("id","slug","name") VALUES (2,'rmsolo','Rocky Mountain Solo')`).run();
  db.prepare(`INSERT INTO "League" ("id","slug","name") VALUES (3,'other','Other Club')`).run();

  const insert = db.prepare(
    `INSERT INTO "ScoringSystem" ("id","leagueId","name","policy") VALUES (?,?,?,?)`,
  );
  insert.run(1, 1, "PCA Classic", PCA_V3);
  insert.run(2, 2, "RMsolo Championship", RMSOLO_V3);
  insert.run(3, 2, "RMsolo Winter", RMSOLO_V3);
  insert.run(4, 3, "Other Default", PCA_V3);

  db.exec(readFileSync(migrationPath, "utf8"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function policy(rulesetId: number): ScoringPolicy {
  const row = db
    .prepare(`SELECT policy FROM "ScoringSystem" WHERE id = ?`)
    .get(rulesetId) as { policy: string };
  return JSON.parse(row.policy) as ScoringPolicy;
}

describe("scoring policy v4 migration", () => {
  it("canonicalizes every v3 ruleset to v4 with the per-class ratio (behavior preserving)", () => {
    expect(policy(1)).toEqual({
      v: 4,
      dropCount: 2,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
      points: { type: "ratio1000", basis: "class" },
    });
    expect(policy(4).points).toEqual({ type: "ratio1000", basis: "class" });
  });

  // The migration is deliberately tenant-blind: it never singles out a league.
  // Moving a league to the event-wide basis is an admin action in the ruleset
  // UI, not a slug match buried in SQL — so an RMsolo-shaped ruleset lands on
  // the same behavior-preserving class basis as everyone else, and nothing
  // about its scoring changes until someone flips it deliberately.
  it("does not single out any league — RMsolo-owned rulesets also land on the class basis", () => {
    expect(policy(2)).toEqual({
      v: 4,
      dropCount: 4,
      dropTiming: "proportional",
      paxSection: true,
      conePenaltyMs: 2000,
      points: { type: "ratio1000", basis: "class" },
    });
    expect(policy(3).points).toEqual({ type: "ratio1000", basis: "class" });
  });

  it("leaves every other policy field untouched", () => {
    expect(policy(2).dropCount).toBe(4);
    expect(policy(2).dropTiming).toBe("proportional");
    expect(policy(2).paxSection).toBe(true);
    expect(policy(2).conePenaltyMs).toBe(2000);
  });

  it("already-v4 rows are left alone, so re-running it cannot clobber an admin's basis choice", () => {
    const rerunDb = new Database(join(tmpDir, "rerun.db"));
    rerunDb.exec(`
      CREATE TABLE "ScoringSystem" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "policy" TEXT NOT NULL
      );
      CREATE TABLE "League" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL
      );
    `);
    // An admin has already switched this ruleset to the event-wide basis.
    rerunDb
      .prepare(`INSERT INTO "ScoringSystem" ("id","leagueId","name","policy") VALUES (1,1,'RMsolo Championship',?)`)
      .run(
        '{"v":4,"dropCount":4,"dropTiming":"proportional","paxSection":true,' +
          '"conePenaltyMs":2000,"points":{"type":"ratio1000","basis":"event"}}',
      );
    rerunDb.exec(readFileSync(migrationPath, "utf8"));
    const row = rerunDb.prepare(`SELECT policy FROM "ScoringSystem" WHERE id = 1`).get() as {
      policy: string;
    };
    expect((JSON.parse(row.policy) as ScoringPolicy).points).toEqual({
      type: "ratio1000",
      basis: "event",
    });
    rerunDb.close();
  });

  it("runs on a database with no rmsolo league", () => {
    const soloDb = new Database(join(tmpDir, "no-rmsolo.db"));
    soloDb.exec(`
      CREATE TABLE "League" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "slug" TEXT NOT NULL,
        "name" TEXT NOT NULL
      );
      CREATE TABLE "ScoringSystem" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "policy" TEXT NOT NULL
      );
    `);
    soloDb.prepare(`INSERT INTO "League" ("id","slug","name") VALUES (1,'pca-rmr','PCA RMR')`).run();
    soloDb
      .prepare(`INSERT INTO "ScoringSystem" ("id","leagueId","name","policy") VALUES (1,1,'PCA Classic',?)`)
      .run(PCA_V3);
    soloDb.exec(readFileSync(migrationPath, "utf8"));
    const row = soloDb.prepare(`SELECT policy FROM "ScoringSystem" WHERE id = 1`).get() as {
      policy: string;
    };
    expect((JSON.parse(row.policy) as ScoringPolicy).points).toEqual({
      type: "ratio1000",
      basis: "class",
    });
    soloDb.close();
  });

  // json_extract() raises "malformed JSON" on a row whose policy text isn't
  // valid JSON, which without the json_valid() guard aborts the whole UPDATE —
  // one corrupt row in one league would block the migration for every other
  // league. The app already tolerates an unparseable policy (preset-dialog's
  // `preset.policy === null` branch), so it must not be fatal here either.
  it("skips a row whose policy isn't valid JSON instead of aborting the whole statement", () => {
    const corruptDb = new Database(join(tmpDir, "corrupt-policy.db"));
    corruptDb.exec(`
      CREATE TABLE "ScoringSystem" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "leagueId" INTEGER NOT NULL,
        "name" TEXT NOT NULL,
        "policy" TEXT NOT NULL
      );
    `);
    const insert = corruptDb.prepare(
      `INSERT INTO "ScoringSystem" ("id","leagueId","name","policy") VALUES (?,?,?,?)`,
    );
    insert.run(1, 1, "Corrupt", "not json at all");
    insert.run(2, 1, "Healthy", PCA_V3);

    expect(() => corruptDb.exec(readFileSync(migrationPath, "utf8"))).not.toThrow();

    const read = (id: number) =>
      (corruptDb.prepare(`SELECT policy FROM "ScoringSystem" WHERE id = ?`).get(id) as {
        policy: string;
      }).policy;

    // The healthy row still migrated...
    expect((JSON.parse(read(2)) as ScoringPolicy).points).toEqual({
      type: "ratio1000",
      basis: "class",
    });
    // ...and the corrupt one is left exactly as it was, no worse off than
    // before: it could not be parsed then either, and the ruleset editor
    // rewrites it in canonical form on the next save.
    expect(read(1)).toBe("not json at all");
    corruptDb.close();
  });
});
