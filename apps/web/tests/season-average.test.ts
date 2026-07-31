import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Unique per-file DB path — repo convention (see rmsolo-ingest.test.ts).
const TEST_DB_PATH = resolve(__dirname, "..", "test-season-average.db");
const TEST_DB_URL = "file:./test-season-average.db";

let prisma: PrismaClient;

// Three events, one class, ruleset dropCount=1, so each driver's best 2 of 3
// count. averagePoints averages COUNTED
// championship scores only (BJ, 2026-07-23) — the dropped score must not
// dilute it.
function event(n: number, aliceSecs: number, bobSecs: number): ParsedRmsoloEvent {
  return {
    title: `Summer 2026#${n}`,
    classCodes: ["AS"],
    entries: [
      {
        classCode: "AS", position: 1, trophy: true, carNumber: "1", altCarNumber: null,
        firstName: "Alice", lastName: "Apex", carDescription: null, hometown: null,
        bestSeconds: aliceSecs,
        runs: [{ seconds: aliceSecs, cones: 0, disposition: "CLEAN" }],
      },
      {
        classCode: "AS", position: 2, trophy: false, carNumber: "2", altCarNumber: null,
        firstName: "Bob", lastName: "Brakes", carDescription: null, hometown: null,
        bestSeconds: bobSecs,
        runs: [{ seconds: bobSecs, cones: 0, disposition: "CLEAN" }],
      },
    ],
  };
}

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  await ingestRmsoloEvent({ parsed: event(1, 40.0, 40.404), sha256: "avg1", date: "2026-04-18" }, prisma);
  await ingestRmsoloEvent({ parsed: event(2, 41.0, 42.268), sha256: "avg2", date: "2026-05-02" }, prisma);
  await ingestRmsoloEvent({ parsed: event(3, 42.0, 44.211), sha256: "avg3", date: "2026-05-16" }, prisma);
  const season = await prisma.season.findFirstOrThrow({ where: { year: 2026 } });
  await prisma.season.update({ where: { id: season.id }, data: { minimumEvents: 2 } });
  await prisma.scoringSystem.update({
    where: { id: season.rulesetId },
    data: {
      policy:
        '{"v":4,"dropCount":1,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,"points":{"type":"ratio1000","basis":"class"}}',
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("averagePoints", () => {
  it("averages COUNTED championship scores only — dropped scores excluded", async () => {
    const result = await buildSeasonLeaderboard(2026, prisma);
    const as = result.sections.find((s) => s.classCode === "AS")!;
    const alice = as.drivers.find((d) => d.driverName === "Alice A.")!;
    const bob = as.drivers.find((d) => d.driverName === "Bob B.")!;
    // 3 completed events with one fixed drop: counted = best 2.
    expect(alice.averagePoints).toBe(1000); // (1000 + 1000) / 2, third 1000 dropped
    // Bob: 990 (40.404), 970 (42.268), 950 (44.211) → counted 990+970 → 980.
    // Mean over all three would be 970 — proves the dropped 950 is excluded.
    expect(bob.averagePoints).toBe(980);
    expect(bob.totalPoints).toBe(1960);
  });
});
