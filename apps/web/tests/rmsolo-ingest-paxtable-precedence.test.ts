import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { RMSOLO_PAX_2026 } from "@/lib/rmsolo-pax";
import { createScoringSystem } from "@/lib/scoring-system";
import type { ParsedRmsoloEvent } from "@/lib/rmsolo-parse";

// Task 3 (reworked by Task R2): end-to-end proof that ingest factors come
// from the season's RULESET paxTable — the COMPLETE table seeded from the
// built-in RMSOLO_PAX_2026 (so a default ruleset still yields built-in
// values), with ruleset overrides winning and unlisted codes resolving to
// 1.0. Unit-level behavior is covered directly in tests/rmsolo-pax.test.ts;
// this file proves it holds through the actual ingest transaction
// (CarClass.paxIndex as written).

const TEST_DB_PATH = resolve(__dirname, "..", "test-rmsolo-paxtable-precedence.db");
const TEST_DB_URL = "file:./test-rmsolo-paxtable-precedence.db";

let prisma: PrismaClient;
let leagueId: number;

function eventFor(carNumber: string, classCode: string): ParsedRmsoloEvent {
  return {
    title: "Summer 2026#1",
    classCodes: [classCode],
    entries: [
      {
        classCode, position: 1, trophy: true, carNumber, altCarNumber: null,
        firstName: "Jamie", lastName: "Runner", carDescription: null, hometown: null,
        bestSeconds: 40.0,
        runs: [{ seconds: 40.0, cones: 0, disposition: "CLEAN" }],
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
  const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
  leagueId = league.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("ruleset paxTable, end-to-end through ingestRmsoloEvent", () => {
  it("uses the factor stored in the season's seeded ruleset table", async () => {
    await ingestRmsoloEvent({ parsed: eventFor("1", "AS"), sha256: "no-override", date: "2026-06-01" }, prisma);
    const cls = await prisma.carClass.findFirstOrThrow({ where: { leagueId, code: "AS" } });
    expect(Number(cls.paxIndex)).toBe(RMSOLO_PAX_2026.AS);
  });

  it("uses a custom factor from the season's authoritative ruleset table", async () => {
    // A distinct season (2027) so this doesn't collide with the no-override
    // 2026 season/class above — same class code, deliberately different
    // custom value (0.5, unmistakable from RMSOLO_PAX_2026.AS).
    const ruleset = await createScoringSystem(prisma, {
      leagueSlug: "pca-rmr",
      name: "2027 Override Rules",
      policyJson: '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}',
      paxTableJson: JSON.stringify({ AS: 0.5 }),
    });
    const season = await prisma.season.create({
      data: {
        leagueId,
        name: "2027 Season",
        slug: "2027-season",
        year: 2027,
        rulesetId: ruleset.id,
      },
    });

    await ingestRmsoloEvent({ parsed: eventFor("2", "AS"), sha256: "with-override", date: "2027-06-01" }, prisma);

    const event = await prisma.event.findUniqueOrThrow({
      where: { seasonId_slug: { seasonId: season.id, slug: "2027-06-01-summer-2026-1" } },
    });
    const entry = await prisma.entry.findFirstOrThrow({
      where: { eventId: event.id, carNumber: "2" },
      include: { class: true },
    });
    expect(Number(entry.class.paxIndex)).toBe(0.5);
    expect(Number(entry.class.paxIndex)).not.toBe(RMSOLO_PAX_2026.AS);
  });

  it("resolves 1.0 for a class code missing from the ruleset table", async () => {
    const ruleset = await createScoringSystem(prisma, {
      leagueSlug: "pca-rmr",
      name: "2028 Rules",
      policyJson: '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}',
      paxTableJson: JSON.stringify({ ZZ: 0.75 }), // covers ZZ, but not the class used below
    });
    const season = await prisma.season.create({
      data: {
        leagueId,
        name: "2028 Season",
        slug: "2028-season",
        year: 2028,
        rulesetId: ruleset.id,
      },
    });
    await ingestRmsoloEvent({ parsed: eventFor("3", "QQQ"), sha256: "fallback-1.0", date: "2028-06-01" }, prisma);
    const event = await prisma.event.findUniqueOrThrow({
      where: { seasonId_slug: { seasonId: season.id, slug: "2028-06-01-summer-2026-1" } },
    });
    const entry = await prisma.entry.findFirstOrThrow({
      where: { eventId: event.id, carNumber: "3" },
      include: { class: true },
    });
    expect(Number(entry.class.paxIndex)).toBe(1.0);
  });
});
