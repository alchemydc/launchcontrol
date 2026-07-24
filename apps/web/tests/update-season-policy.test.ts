import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createLeague } from "@/lib/create-league";
import { createSeason, updateSeason } from "@/lib/create-season";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Task 2: per-season scoringPolicy editing via updateSeason's new
// `scoringPolicy` patch key (raw JSON string, validated/re-serialized via
// parseScoringPolicy). Mirrors league-admin-crud.test.ts's updateSeason
// conventions — each test builds its own scratch league+season.

const FIXED_POLICY = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';
const PROPORTIONAL_POLICY = '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":2000}';

const { path: TEST_DB_PATH, url: TEST_DB_URL } = dbTarget("update-season-policy");

let prisma: PrismaClient;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  migrateDeploy(TEST_DB_URL);
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("updateSeason scoringPolicy", () => {
  it("updates the row's scoringPolicy and it parses back with the new values", async () => {
    const { league } = await createLeague({ slug: "usp-basic", name: "USP Basic League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Season", year: 2102 }, prisma);
    // Force a known starting policy — createSeason without preset/file snapshots
    // whatever the league's oldest ScoringSystem preset happens to be, which
    // this test shouldn't depend on.
    await prisma.season.update({ where: { id: season.id }, data: { scoringPolicy: FIXED_POLICY } });

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { scoringPolicy: PROPORTIONAL_POLICY },
    );

    expect(JSON.parse(updated.scoringPolicy).drops).toBe("proportional");

    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(JSON.parse(persisted.scoringPolicy).drops).toBe("proportional");
  });

  it("rejects an invalid policy and leaves the row unchanged", async () => {
    const { league } = await createLeague({ slug: "usp-invalid", name: "USP Invalid League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Invalid Season", year: 2103 }, prisma);
    const before = season.scoringPolicy;

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: season.slug },
        { scoringPolicy: '{"v":1}' },
      ),
    ).rejects.toThrow(/scoringPolicy\./);

    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.scoringPolicy).toBe(before);
  });

  it("leaves scoringPolicy untouched when absent from the patch", async () => {
    const { league } = await createLeague({ slug: "usp-absent", name: "USP Absent League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Absent Season", year: 2104 }, prisma);
    const before = season.scoringPolicy;

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { plannedEvents: 3 },
    );

    expect(updated.scoringPolicy).toBe(before);
    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.scoringPolicy).toBe(before);
  });
});
