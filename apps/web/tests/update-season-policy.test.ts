import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createLeague } from "@/lib/create-league";
import { createSeason, updateSeason } from "@/lib/create-season";
import { createScoringSystem } from "@/lib/scoring-system";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Task R2: per-season scoring is edited by re-pointing the season's live
// `rulesetId` reference via updateSeason's `rulesetId` patch key (validated:
// the ruleset must exist and belong to the SAME league). Mirrors
// league-admin-crud.test.ts's updateSeason conventions — each test builds
// its own scratch league+season.

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

describe("updateSeason rulesetId", () => {
  it("re-points the season at another ruleset of the same league", async () => {
    const { league } = await createLeague({ slug: "usp-basic", name: "USP Basic League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Season", year: 2102 }, prisma);
    const other = await createScoringSystem(prisma, {
      leagueSlug: league.slug,
      name: "USP Proportional",
      policyJson: PROPORTIONAL_POLICY,
    });
    expect(season.rulesetId).not.toBe(other.id);

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { rulesetId: other.id },
    );

    expect(updated.rulesetId).toBe(other.id);
    const persisted = await prisma.season.findUniqueOrThrow({
      where: { id: season.id },
      include: { ruleset: true },
    });
    expect(persisted.rulesetId).toBe(other.id);
    expect(JSON.parse(persisted.ruleset.policy).drops).toBe("proportional");
  });

  it("rejects an unknown rulesetId and leaves the row unchanged", async () => {
    const { league } = await createLeague({ slug: "usp-invalid", name: "USP Invalid League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Invalid Season", year: 2103 }, prisma);

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: season.slug },
        { rulesetId: 999999 },
      ),
    ).rejects.toThrow(/no ruleset with id 999999/);

    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.rulesetId).toBe(season.rulesetId);
  });

  it("rejects a ruleset belonging to a DIFFERENT league", async () => {
    const { league } = await createLeague({ slug: "usp-cross-a", name: "USP Cross League A" }, prisma);
    const { league: leagueB } = await createLeague({ slug: "usp-cross-b", name: "USP Cross League B" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Cross Season", year: 2105 }, prisma);
    const foreign = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: leagueB.id } });

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: season.slug },
        { rulesetId: foreign.id },
      ),
    ).rejects.toThrow(/only adopt a ruleset of its own league/);

    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.rulesetId).toBe(season.rulesetId);
  });

  it("leaves rulesetId untouched when absent from the patch", async () => {
    const { league } = await createLeague({ slug: "usp-absent", name: "USP Absent League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "USP Absent Season", year: 2104 }, prisma);

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { plannedEvents: 3 },
    );

    expect(updated.rulesetId).toBe(season.rulesetId);
    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.rulesetId).toBe(season.rulesetId);
  });
});
