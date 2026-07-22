import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Unique per-file DB path — see rmsolo-ingest.test.ts for the rationale.
const TEST_DB_PATH = resolve(__dirname, "..", "test-season-pax.db");
const TEST_DB_URL = "file:./test-season-pax.db";

let prisma: PrismaClient;

// One event, two classes with different PAX factors:
//   AS  (0.830): Alice 40.000s → pax 33200ms   (overall PAX winner)
//   BST (0.835): Bella 39.900s → pax 33317ms
// Class points give both drivers 1000 (each wins her class); PAX points
// separate them: Alice 1000, Bella round(1000×33200/33317) = 996.
const parsed: ParsedRmsoloEvent = {
  title: "Summer 2026#1",
  classCodes: ["AS", "BST"],
  entries: [
    {
      classCode: "AS", position: 1, trophy: true, carNumber: "1", altCarNumber: null,
      firstName: "Alice", lastName: "Apex", carDescription: null, hometown: null,
      bestSeconds: 40.0,
      runs: [{ seconds: 40.0, cones: 0, disposition: "CLEAN" }],
    },
    {
      classCode: "BST", position: 1, trophy: true, carNumber: "2", altCarNumber: null,
      firstName: "Bella", lastName: "Brakes", carDescription: null, hometown: null,
      bestSeconds: 39.9,
      runs: [{ seconds: 39.9, cones: 0, disposition: "CLEAN" }],
    },
  ],
};

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  await ingestRmsoloEvent({ parsed, sha256: "seasonpax1", date: "2026-04-18" }, prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

afterEach(() => {
  delete process.env.PAX_STANDINGS;
  delete process.env.PLANNED_SEASON_EVENTS;
});

describe("season PAX section (PAX_STANDINGS)", () => {
  it("is absent by default — PCA leaderboard unchanged", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    expect(result.sections.map((s) => s.classCode)).toEqual(["AS", "BST"]);
  });

  it("adds an overall PAX section pinned first when enabled", async () => {
    process.env.PAX_STANDINGS = "1";
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    expect(result.sections.map((s) => s.classCode)).toEqual(["PAX", "AS", "BST"]);

    const pax = result.sections[0]!;
    expect(pax.drivers).toHaveLength(2);
    expect(pax.drivers[0]).toMatchObject({ driverName: "Alice A.", totalPoints: 1000 });
    expect(pax.drivers[1]!.totalPoints).toBe(996); // round(1000 × 33200 / 33317)
  });

  it("class sections are unaffected by the PAX section", async () => {
    process.env.PAX_STANDINGS = "1";
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    const as = result.sections.find((s) => s.classCode === "AS")!;
    expect(as.drivers[0]!.totalPoints).toBe(1000);
  });
});

describe("PLANNED_SEASON_EVENTS env override", () => {
  it("raises the qualifying threshold from the env map", async () => {
    // No explicit planned map passed — buildSeasonLeaderboard falls back to
    // the env override, then the built-in PCA map.
    process.env.PLANNED_SEASON_EVENTS = "2026:10";
    const result = await buildSeasonLeaderboard(2026, prisma);
    expect(result.totalEvents).toBe(10);
    expect(result.qualifyingEvents).toBe(6); // floor(10/2)+1 — best 6 of 10 count
  });
});
