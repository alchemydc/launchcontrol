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
  it("canonicalizes non-RMsolo rulesets to v4 with the per-class ratio (behavior preserving)", () => {
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

  it("puts every ruleset owned by the rmsolo league on the event-wide ratio", () => {
    expect(policy(2)).toEqual({
      v: 4,
      dropCount: 4,
      dropTiming: "proportional",
      paxSection: true,
      conePenaltyMs: 2000,
      points: { type: "ratio1000", basis: "event" },
    });
    expect(policy(3).points).toEqual({ type: "ratio1000", basis: "event" });
  });

  it("leaves every other policy field untouched", () => {
    expect(policy(2).dropCount).toBe(4);
    expect(policy(2).dropTiming).toBe("proportional");
    expect(policy(2).conePenaltyMs).toBe(2000);
  });

  it("is a no-op on a database with no rmsolo league", () => {
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
});
