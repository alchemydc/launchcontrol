import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createLeague, deleteLeague, updateLeague } from "@/lib/create-league";
import { createSeason, updateSeason } from "@/lib/create-season";
import { createScoringSystem, updateScoringSystem } from "@/lib/scoring-system";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Unit tests for the admin CRUD lib functions the Task 13 REST routes call:
// updateLeague/deleteLeague (create-league.ts), updateSeason (create-season.ts),
// createScoringSystem/updateScoringSystem (scoring-system.ts). Mirrors
// tests/create-league.test.ts and tests/create-season.test.ts's conventions —
// each test builds its own scratch league (via createLeague) so tests stay
// independent within a single shared DB file.

const PCA_POLICY = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';
const RMSOLO_POLICY = '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":1000}';

const { path: TEST_DB_PATH, url: TEST_DB_URL } = dbTarget("league-admin-crud");

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

describe("updateLeague", () => {
  it("patches branding + gate", async () => {
    const { league } = await createLeague({ slug: "ul-branding", name: "UL Branding League" }, prisma);

    const updated = await updateLeague(
      prisma,
      league.slug,
      {
        name: "UL Branding League Renamed",
        siteTitle: "New Site Title",
        siteDescription: "New description.",
        footerText: "New footer.",
        landingDescription: "New landing copy.",
        accessGate: "none",
        msrOrgId: "org-123",
        logoUrl: "https://example.com/logo.png",
        smugmugUser: "smug-user",
        smugmugDisciplinePath: "/autocross",
      },
    );

    expect(updated.name).toBe("UL Branding League Renamed");
    expect(updated.siteTitle).toBe("New Site Title");
    expect(updated.siteDescription).toBe("New description.");
    expect(updated.footerText).toBe("New footer.");
    expect(updated.landingDescription).toBe("New landing copy.");
    expect(updated.accessGate).toBe("none");
    expect(updated.msrOrgId).toBe("org-123");
    expect(updated.logoUrl).toBe("https://example.com/logo.png");
    expect(updated.smugmugUser).toBe("smug-user");
    expect(updated.smugmugDisciplinePath).toBe("/autocross");

    const persisted = await prisma.league.findUniqueOrThrow({ where: { slug: league.slug } });
    expect(persisted.name).toBe("UL Branding League Renamed");
    expect(persisted.accessGate).toBe("none");
  });

  it("only touches fields present in the patch, and null clears a nullable field", async () => {
    const { league } = await createLeague(
      { slug: "ul-partial", name: "UL Partial League", footer: "Original footer." },
      prisma,
    );

    const updated = await updateLeague(prisma, league.slug, { footerText: null });
    expect(updated.footerText).toBeNull();
    expect(updated.name).toBe("UL Partial League"); // untouched
    expect(updated.siteTitle).toBe(league.siteTitle); // untouched
  });

  it("rejects bad gate and bad logoUrl", async () => {
    const { league } = await createLeague({ slug: "ul-bad-gate-url", name: "UL Bad League" }, prisma);

    await expect(
      updateLeague(prisma, league.slug, { accessGate: "sideways" as never }),
    ).rejects.toThrow(/--gate must be one of required, optional, none/);

    await expect(
      updateLeague(prisma, league.slug, { logoUrl: "not a url" }),
    ).rejects.toThrow(/--logo-url must be a valid http\(s\) URL/);

    // Neither rejected write actually landed.
    const persisted = await prisma.league.findUniqueOrThrow({ where: { slug: league.slug } });
    expect(persisted.accessGate).toBe("optional");
    expect(persisted.logoUrl).toBeNull();
  });

  it("rejects an unknown league slug", async () => {
    await expect(updateLeague(prisma, "does-not-exist", { name: "x" })).rejects.toThrow(
      /unknown league 'does-not-exist'/,
    );
  });
});

describe("deleteLeague", () => {
  it("deletes an eventless league (cascades preset + membership)", async () => {
    const { league } = await createLeague({ slug: "dl-eventless", name: "DL Eventless League" }, prisma);
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, msrUid: "uid-1", role: "MEMBER" },
    });

    await deleteLeague(prisma, league.slug);

    expect(await prisma.league.findUnique({ where: { slug: league.slug } })).toBeNull();
    expect(await prisma.scoringSystem.findFirst({ where: { leagueId: league.id } })).toBeNull();
    expect(await prisma.leagueMembership.findFirst({ where: { leagueId: league.id } })).toBeNull();
  });

  it("deletes an eventless league's seasons too", async () => {
    const { league } = await createLeague({ slug: "dl-with-season", name: "DL With Season League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "DL Season", year: 2090 }, prisma);

    await deleteLeague(prisma, league.slug);

    expect(await prisma.season.findUnique({ where: { id: season.id } })).toBeNull();
  });

  it("deletes an eventless league's orphaned CarClass rows too", async () => {
    // Simulates a league whose events were all deleted via deleteEventWithSweep,
    // which leaves CarClass rows behind (CarClass.leagueId is ON DELETE RESTRICT).
    const { league } = await createLeague({ slug: "dl-orphan-class", name: "DL Orphan Class League" }, prisma);
    const carClass = await prisma.carClass.create({
      data: { leagueId: league.id, code: "STK" },
    });

    await deleteLeague(prisma, league.slug);

    expect(await prisma.league.findUnique({ where: { slug: league.slug } })).toBeNull();
    expect(await prisma.carClass.findUnique({ where: { id: carClass.id } })).toBeNull();
  });

  it("refuses when events exist", async () => {
    const { league } = await createLeague({ slug: "dl-has-events", name: "DL Has Events League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "DL Events Season", year: 2091 }, prisma);
    await prisma.event.create({
      data: {
        seasonId: season.id,
        slug: "dl-event",
        name: "DL Event",
        date: new Date("2091-05-01T00:00:00.000Z"),
      },
    });
    const carClass = await prisma.carClass.create({
      data: { leagueId: league.id, code: "STK" },
    });

    await expect(deleteLeague(prisma, league.slug)).rejects.toThrow(/has events/i);

    // Nothing was deleted.
    expect(await prisma.league.findUnique({ where: { slug: league.slug } })).not.toBeNull();
    expect(await prisma.season.findUnique({ where: { id: season.id } })).not.toBeNull();
    expect(await prisma.carClass.findUnique({ where: { id: carClass.id } })).not.toBeNull();
  });

  it("rejects an unknown league slug", async () => {
    await expect(deleteLeague(prisma, "does-not-exist")).rejects.toThrow(/unknown league 'does-not-exist'/);
  });
});

describe("updateSeason", () => {
  it("patches plannedEvents/status/rulesetId", async () => {
    const { league } = await createLeague({ slug: "us-basic", name: "US Basic League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "US Season", year: 2092 }, prisma);
    const other = await createScoringSystem(prisma, {
      leagueSlug: league.slug,
      name: "US Other Ruleset",
      policyJson: RMSOLO_POLICY,
    });

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { plannedEvents: 9, status: "completed", rulesetId: other.id },
    );

    expect(updated.plannedEvents).toBe(9);
    expect(updated.status).toBe("completed");
    expect(updated.rulesetId).toBe(other.id);

    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.plannedEvents).toBe(9);
    expect(persisted.status).toBe("completed");
  });

  it("patches name/slug/year", async () => {
    const { league } = await createLeague({ slug: "us-rename", name: "US Rename League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "US Old Name", year: 2093 }, prisma);

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { name: "US New Name", slug: "us-new-slug", year: 2094 },
    );

    expect(updated.name).toBe("US New Name");
    expect(updated.slug).toBe("us-new-slug");
    expect(updated.year).toBe(2094);
  });

  it("rejects invalid status, invalid rulesetId, duplicate slug", async () => {
    const { league } = await createLeague({ slug: "us-invalid", name: "US Invalid League" }, prisma);
    const seasonA = await createSeason({ leagueSlug: league.slug, name: "US Season A", year: 2095 }, prisma);
    const seasonB = await createSeason({ leagueSlug: league.slug, name: "US Season B", year: 2096 }, prisma);

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: seasonA.slug },
        { status: "sideways" as never },
      ),
    ).rejects.toThrow(/status must be one of active, completed/);

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: seasonA.slug },
        { rulesetId: 999999 },
      ),
    ).rejects.toThrow(/no ruleset with id/);

    await expect(
      updateSeason(
        prisma,
        { leagueSlug: league.slug, seasonSlug: seasonA.slug },
        { slug: seasonB.slug },
      ),
    ).rejects.toThrow(/already has a season with slug/);

    // Nothing landed.
    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: seasonA.id } });
    expect(persisted.status).toBe("active");
    expect(persisted.rulesetId).toBe(seasonA.rulesetId);
    expect(persisted.slug).toBe(seasonA.slug);
  });

  it("rejects a duplicate name", async () => {
    const { league } = await createLeague({ slug: "us-dup-name", name: "US Dup Name League" }, prisma);
    const seasonA = await createSeason({ leagueSlug: league.slug, name: "US Dup A", year: 2097 }, prisma);
    const seasonB = await createSeason({ leagueSlug: league.slug, name: "US Dup B", year: 2098 }, prisma);

    await expect(
      updateSeason(prisma, { leagueSlug: league.slug, seasonSlug: seasonB.slug }, { name: seasonA.name }),
    ).rejects.toThrow(/already has a season named/);
  });

  it("rejects an unknown league or season", async () => {
    const { league } = await createLeague({ slug: "us-unknown", name: "US Unknown League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "US Unknown Season", year: 2099 }, prisma);

    await expect(
      updateSeason(prisma, { leagueSlug: "does-not-exist", seasonSlug: season.slug }, { plannedEvents: 1 }),
    ).rejects.toThrow(/unknown league 'does-not-exist'/);

    await expect(
      updateSeason(prisma, { leagueSlug: league.slug, seasonSlug: "does-not-exist" }, { plannedEvents: 1 }),
    ).rejects.toThrow(/no season with slug 'does-not-exist'/);
  });

  it("leaves rulesetId untouched when the patch omits it", async () => {
    const { league } = await createLeague({ slug: "us-policy-snapshot", name: "US Policy Snapshot League" }, prisma);
    const season = await createSeason({ leagueSlug: league.slug, name: "US Policy Season", year: 2100 }, prisma);
    const before = season.rulesetId;

    const updated = await updateSeason(
      prisma,
      { leagueSlug: league.slug, seasonSlug: season.slug },
      { name: "US Policy Season Renamed", plannedEvents: 5, status: "completed" },
    );

    expect(updated.rulesetId).toBe(before);
    const persisted = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(persisted.rulesetId).toBe(before);
  });
});

describe("scoring systems", () => {
  it("create validates policy; duplicate name rejected", async () => {
    const { league } = await createLeague({ slug: "ss-create", name: "SS Create League" }, prisma);

    const preset = await createScoringSystem(prisma, {
      leagueSlug: league.slug,
      name: "Custom Preset",
      policyJson: RMSOLO_POLICY,
    });
    expect(preset.name).toBe("Custom Preset");
    expect(preset.policy).toBe(RMSOLO_POLICY);

    await expect(
      createScoringSystem(prisma, {
        leagueSlug: league.slug,
        name: "Custom Preset",
        policyJson: PCA_POLICY,
      }),
    ).rejects.toThrow(/already has a scoring system preset named 'Custom Preset'/);

    await expect(
      createScoringSystem(prisma, {
        leagueSlug: league.slug,
        name: "Bad Policy Preset",
        policyJson: '{"v":2,"drops":"sideways","paxSection":false,"conePenaltyMs":2000}',
      }),
    ).rejects.toThrow(/scoringPolicy\.drops/);
  });

  it("update validates policy; duplicate name rejected; unknown preset rejected", async () => {
    const { league } = await createLeague({ slug: "ss-update", name: "SS Update League" }, prisma);
    const presetA = await createScoringSystem(prisma, {
      leagueSlug: league.slug,
      name: "Preset A",
      policyJson: PCA_POLICY,
    });
    await createScoringSystem(prisma, { leagueSlug: league.slug, name: "Preset B", policyJson: PCA_POLICY });

    const updated = await updateScoringSystem(
      prisma,
      { leagueSlug: league.slug, name: presetA.name },
      { policyJson: RMSOLO_POLICY },
    );
    expect(updated.policy).toBe(RMSOLO_POLICY);

    await expect(
      updateScoringSystem(prisma, { leagueSlug: league.slug, name: "Preset A" }, { name: "Preset B" }),
    ).rejects.toThrow(/already has a scoring system preset named 'Preset B'/);

    await expect(
      updateScoringSystem(
        prisma,
        { leagueSlug: league.slug, name: "Preset A" },
        { policyJson: '{"v":2,"drops":"sideways"}' },
      ),
    ).rejects.toThrow(/scoringPolicy\.drops/);

    await expect(
      updateScoringSystem(prisma, { leagueSlug: league.slug, name: "Nonexistent" }, { policyJson: PCA_POLICY }),
    ).rejects.toThrow(/no scoring system preset named 'Nonexistent'/);
  });

  it("editing a ruleset flows through to an adopted season (live reference)", async () => {
    const { league } = await createLeague({ slug: "ss-adopted", name: "SS Adopted League" }, prisma);
    const preset = await createScoringSystem(prisma, {
      leagueSlug: league.slug,
      name: "Adopted Preset",
      policyJson: PCA_POLICY,
    });
    const season = await createSeason(
      { leagueSlug: league.slug, name: "SS Adopted Season", year: 2101, presetName: preset.name },
      prisma,
    );
    expect(season.rulesetId).toBe(preset.id);

    // Now edit the ruleset to a different, still-valid policy.
    await updateScoringSystem(
      prisma,
      { leagueSlug: league.slug, name: preset.name },
      { policyJson: RMSOLO_POLICY },
    );

    // THE invariant (Task R2): the season reads the edit live.
    const persisted = await prisma.season.findUniqueOrThrow({
      where: { id: season.id },
      include: { ruleset: true },
    });
    expect(persisted.rulesetId).toBe(preset.id);
    expect(persisted.ruleset.policy).toBe(RMSOLO_POLICY);
  });
});
