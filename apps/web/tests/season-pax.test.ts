import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { buildSeasonLeaderboard, countedEventTarget } from "@/lib/season-leaderboard";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Unique per-file DB path — see rmsolo-ingest.test.ts for the rationale.
const TEST_DB_PATH = resolve(__dirname, "..", "test-season-pax.db");
const TEST_DB_URL = "file:./test-season-pax.db";

let prisma: PrismaClient;

// One event, two standard classes plus an "X" run group whose raw and pax
// orders INVERT (the run-group correctness case):
//   AS  (0.830): Alice 40.000s → pax 33200ms   (overall PAX winner)
//               Carol 42.000s → pax 34860ms
//   BST (0.835): Bella 39.900s → pax 33317ms
//   X: Xena raw 41.000s, printed indexed Best 33.251 (→ derived DS 0.811)
//      Yuri raw 40.500s, printed indexed Best 33.858 (→ derived AST 0.836)
//      Raw order: Yuri < Xena. Official (indexed) order: Xena < Yuri.
const parsed: ParsedRmsoloEvent = {
  title: "Summer 2026#1",
  classCodes: ["AS", "BST", "X"],
  entries: [
    {
      classCode: "AS", position: 1, trophy: true, carNumber: "1", altCarNumber: null,
      firstName: "Alice", lastName: "Apex", carDescription: null, hometown: null,
      bestSeconds: 40.0,
      runs: [{ seconds: 40.0, cones: 0, disposition: "CLEAN" }],
    },
    {
      classCode: "AS", position: 2, trophy: false, carNumber: "3", altCarNumber: null,
      firstName: "Carol", lastName: "Corner", carDescription: null, hometown: null,
      bestSeconds: 42.0,
      runs: [{ seconds: 42.0, cones: 0, disposition: "CLEAN" }],
    },
    {
      classCode: "BST", position: 1, trophy: true, carNumber: "2", altCarNumber: null,
      firstName: "Bella", lastName: "Brakes", carDescription: null, hometown: null,
      bestSeconds: 39.9,
      runs: [{ seconds: 39.9, cones: 0, disposition: "CLEAN" }],
    },
    {
      classCode: "X", position: 1, trophy: true, carNumber: "9", altCarNumber: null,
      firstName: "Xena", lastName: "Xtreme", carDescription: null, hometown: null,
      bestSeconds: 33.251, // 41.000 × 0.811 (DS)
      runs: [{ seconds: 41.0, cones: 0, disposition: "CLEAN" }],
    },
    {
      classCode: "X", position: 2, trophy: false, carNumber: "8", altCarNumber: null,
      firstName: "Yuri", lastName: "Yaw", carDescription: null, hometown: null,
      bestSeconds: 33.858, // 40.500 × 0.836 (AST)
      runs: [{ seconds: 40.5, cones: 0, disposition: "CLEAN" }],
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
  it("is absent by default — PCA leaderboard unchanged, run-group ranked by raw", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    expect(result.sections.map((s) => s.classCode)).toEqual(["AS", "BST", "X"]);
    // Default (fixed/raw) metric: Yuri's faster RAW time wins X.
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => d.driverName)).toEqual(["Yuri Y.", "Xena X."]);
    expect(x.drivers[0]!.totalPoints).toBe(1000);
    expect(x.drivers[1]!.totalPoints).toBe(988); // round(1000 × 40500 / 41000)
  });

  it("adds an overall PAX section pinned first when enabled", async () => {
    process.env.PAX_STANDINGS = "1";
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    expect(result.sections.map((s) => s.classCode)).toEqual(["PAX", "AS", "BST", "X"]);

    const pax = result.sections[0]!;
    expect(pax.drivers).toHaveLength(5);
    expect(pax.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Alice A.", 1000],
      ["Xena X.", 998], // round(1000 × 33200 / 33251)
      ["Bella B.", 996], // round(1000 × 33200 / 33317)
      ["Yuri Y.", 981], // round(1000 × 33200 / 33858)
      ["Carol C.", 952], // round(1000 × 33200 / 34860)
    ]);
  });

  it("uniform-factor class sections keep identical points; run groups rank by pax", async () => {
    process.env.PAX_STANDINGS = "1";
    const result = await buildSeasonLeaderboard(2026, prisma, {});
    const as = result.sections.find((s) => s.classCode === "AS")!;
    // Same factor ⇒ pax metric is a pure rescale ⇒ identical points to raw.
    expect(as.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Alice A.", 1000],
      ["Carol C.", 952], // round(1000 × 40000 / 42000) — unchanged from raw
    ]);
    // Heterogeneous run group ⇒ official (indexed) order: Xena beats Yuri.
    const x = result.sections.find((s) => s.classCode === "X")!;
    expect(x.drivers.map((d) => [d.driverName, d.totalPoints])).toEqual([
      ["Xena X.", 1000],
      ["Yuri Y.", 982], // round(1000 × 33251 / 33858)
    ]);
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
    expect(result.countedEvents).toBe(6); // fixed mode: counted == qualifying
  });

  it("exposes the proportional counted target for the view copy", async () => {
    process.env.PLANNED_SEASON_EVENTS = "2026:10";
    process.env.SEASON_DROPS = "proportional";
    const result = await buildSeasonLeaderboard(2026, prisma);
    // 1 completed event of 10: floor(1×4/10)=0 drops → counted 1.
    expect(result.countedEvents).toBe(1);
    delete process.env.SEASON_DROPS;
  });
});

describe("countedEventTarget (SEASON_DROPS)", () => {
  it("fixed mode counts the qualifying threshold regardless of progress", () => {
    expect(countedEventTarget(10, 6, 5, "fixed")).toBe(6);
    expect(countedEventTarget(6, 4, 3, "fixed")).toBe(4);
  });

  it("proportional mode scales drops with completed events", () => {
    expect(countedEventTarget(10, 6, 5, "proportional")).toBe(3); // half season → half of 4 drops
    expect(countedEventTarget(10, 6, 10, "proportional")).toBe(6); // full season → best 6 of 10
    expect(countedEventTarget(10, 6, 1, "proportional")).toBe(1);
    expect(countedEventTarget(10, 6, 7, "proportional")).toBe(5); // 7 - floor(7×4/10)=7-2
  });

  it("degenerate seasons never drop below one counted event", () => {
    expect(countedEventTarget(0, 0, 0, "proportional")).toBe(0);
    expect(countedEventTarget(2, 2, 1, "proportional")).toBe(1);
  });
});
