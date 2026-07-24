import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveOrCreateSeason } from "@/lib/season-resolve";
import { DEFAULT_SCORING_POLICY } from "./helpers/league-fixture";
import { dbTarget, migrateDeploy } from "./helpers/db";

// resolveOrCreateSeason is ingest's (league, year) landing-spot resolver.
// Multiple seasons per (league, year) are a supported feature (e.g. a Winter
// Series alongside the main season) -- these tests pin that ingest prefers
// the year's ACTIVE season over an archived ("completed") one, only falling
// back to the oldest-by-id season when the year has no active season at all.

describe("resolveOrCreateSeason: active-season preference", () => {
  const { path, url } = dbTarget("season-resolve-active");
  let client: PrismaClient;
  let leagueId: number;

  beforeAll(() => {
    rmSync(path, { force: true });
    migrateDeploy(url);
    client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(path, { force: true });
  });

  it("prefers the active season over an id-older completed season in the same year", async () => {
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    leagueId = league.id;

    const winter = await client.season.create({
      data: {
        leagueId,
        name: "2026 Winter",
        slug: "2026-winter",
        year: 2026,
        scoringPolicy: DEFAULT_SCORING_POLICY,
        status: "completed",
      },
    });
    const summer = await client.season.create({
      data: {
        leagueId,
        name: "2026 Summer",
        slug: "2026-summer",
        year: 2026,
        scoringPolicy: DEFAULT_SCORING_POLICY,
        status: "active",
      },
    });
    expect(summer.id).toBeGreaterThan(winter.id);

    const resolved = await resolveOrCreateSeason(client, { id: leagueId, slug: "pca-rmr" }, 2026);
    expect(resolved.id).toBe(summer.id);
  });

  it("falls back to the oldest season when none are active", async () => {
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });

    const first = await client.season.create({
      data: {
        leagueId: league.id,
        name: "2027 Winter",
        slug: "2027-winter",
        year: 2027,
        scoringPolicy: DEFAULT_SCORING_POLICY,
        status: "completed",
      },
    });
    await client.season.create({
      data: {
        leagueId: league.id,
        name: "2027 Summer",
        slug: "2027-summer",
        year: 2027,
        scoringPolicy: DEFAULT_SCORING_POLICY,
        status: "completed",
      },
    });

    const resolved = await resolveOrCreateSeason(client, { id: league.id, slug: "pca-rmr" }, 2027);
    expect(resolved.id).toBe(first.id);
  });

  it("auto-creates a season with status active when the year has none", async () => {
    const league = await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });

    const created = await resolveOrCreateSeason(client, { id: league.id, slug: "pca-rmr" }, 2028);
    expect(created.status).toBe("active");
  });
});
