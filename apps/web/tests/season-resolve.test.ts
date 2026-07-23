import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";
import {
  activeSeason,
  listSeasonsForLeague,
  resolveOrCreateSeason,
  resolveSeasonBySlug,
} from "@/lib/season-resolve";

// Task 2: season addressing. `resolveOrCreateSeason`'s auto-create path is
// exercised elsewhere too (tests/league-seed.test.ts, tests/ingest-season-policy.test.ts)
// via ingest — these tests pin its slug behavior specifically, plus the two
// new addressing helpers public browsing routes will use (Task 5):
// `resolveSeasonBySlug` (by (league, slug)) and `activeSeason` (status
// "active", newest year, tie -> newest id).

const TEST_DB_PATH = resolve(__dirname, "..", "test-season-resolve.db");
const TEST_DB_URL = "file:./test-season-resolve.db";
const PCA_POLICY = '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';

let prisma: PrismaClient;
let leagueId: number;

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

describe("resolveOrCreateSeason", () => {
  it("auto-created seasons get slug = slugify(name)", async () => {
    const season = await resolveOrCreateSeason(prisma, { id: leagueId, slug: "pca-rmr" }, 2091);
    expect(season.name).toBe("2091 Season");
    expect(season.slug).toBe(slugify("2091 Season"));
    expect(season.slug).toBe("2091-season");
  });

  // Task 3 folded fix: an operator-created season whose slug happens to match
  // what auto-create would produce for a DIFFERENT year must not surface a raw
  // Prisma P2002 on the (leagueId, slug) unique index — the operator gets a
  // friendly message naming the colliding slug/season instead.
  it("throws a friendly error when an operator-created season's slug collides with the auto-create slug for a different year", async () => {
    // "2026-season" is exactly what auto-create would slugify `${2026} Season`
    // to — but here it's an operator-created season for 2099, not 2026.
    const colliding = await prisma.season.create({
      data: {
        leagueId,
        name: "2026 Season",
        slug: "2026-season",
        year: 2099,
        scoringPolicy:
          '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}',
      },
    });

    await expect(resolveOrCreateSeason(prisma, { id: leagueId, slug: "pca-rmr" }, 2026)).rejects.toThrow(
      new RegExp(
        `slug '2026-season' is already used by season '2026 Season' \\(id=${colliding.id}, year=2099\\)`,
      ),
    );
  });
});

describe("resolveSeasonBySlug", () => {
  it("resolves a season by (leagueId, slug)", async () => {
    const created = await prisma.season.create({
      data: {
        leagueId,
        name: "2092 Custom Season",
        slug: "custom-2092",
        year: 2092,
        scoringPolicy: PCA_POLICY,
      },
    });
    const resolved = await resolveSeasonBySlug(prisma, leagueId, "custom-2092");
    expect(resolved?.id).toBe(created.id);
  });

  it("returns null for an unknown slug", async () => {
    expect(await resolveSeasonBySlug(prisma, leagueId, "does-not-exist")).toBeNull();
  });

  it("is scoped to the given league — a slug that exists in another league does not resolve", async () => {
    const otherLeague = await prisma.league.create({
      data: {
        slug: "other-league",
        name: "Other League",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await prisma.season.create({
      data: {
        leagueId: otherLeague.id,
        name: "Other League Season",
        slug: "custom-2092", // same slug text as the pca-rmr season above
        year: 2092,
        scoringPolicy: PCA_POLICY,
      },
    });
    // Resolving under the ORIGINAL league still finds the original season.
    const resolved = await resolveSeasonBySlug(prisma, leagueId, "custom-2092");
    expect(resolved?.name).toBe("2092 Custom Season");
  });
});

describe("activeSeason", () => {
  it("picks the newest year among active seasons", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "active-season-year-test",
        name: "Active Season Year Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2020 Season",
        slug: "2020-season",
        year: 2020,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });
    const newest = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2023 Season",
        slug: "2023-season",
        year: 2023,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });

    const resolved = await activeSeason(prisma, league.id);
    expect(resolved?.id).toBe(newest.id);
  });

  it("ignores non-active seasons even if their year is newer", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "active-season-status-test",
        name: "Active Season Status Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    const active = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2024 Season",
        slug: "2024-season",
        year: 2024,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });
    await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2025 Season",
        slug: "2025-season",
        year: 2025,
        scoringPolicy: PCA_POLICY,
        status: "completed",
      },
    });

    const resolved = await activeSeason(prisma, league.id);
    expect(resolved?.id).toBe(active.id);
  });

  it("breaks a same-year tie by newest id", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "active-season-tie-test",
        name: "Active Season Tie Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    const first = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2030 Season",
        slug: "2030-season",
        year: 2030,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });
    // Same year as `first`, created after it (higher id) — must win the tie.
    const second = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2030 Winter Series",
        slug: "2030-winter-series",
        year: 2030,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });
    expect(second.id).toBeGreaterThan(first.id);

    const resolved = await activeSeason(prisma, league.id);
    expect(resolved?.id).toBe(second.id);
  });

  it("returns null for a league with no active seasons", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "active-season-none-test",
        name: "Active Season None Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2019 Season",
        slug: "2019-season",
        year: 2019,
        scoringPolicy: PCA_POLICY,
        status: "completed",
      },
    });
    expect(await activeSeason(prisma, league.id)).toBeNull();
  });
});

// Task 5: powers the league-scoped leaderboard season switcher, which
// addresses seasons by slug and labels them by name (unlike the legacy
// year-based switcher) — a league can have more than one season per year.
describe("listSeasonsForLeague", () => {
  it("lists every season for a league, newest year first", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "list-seasons-test",
        name: "List Seasons Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await prisma.season.create({
      data: { leagueId: league.id, name: "2024 Season", slug: "2024-season", year: 2024, scoringPolicy: PCA_POLICY },
    });
    await prisma.season.create({
      data: { leagueId: league.id, name: "2026 Season", slug: "2026-season", year: 2026, scoringPolicy: PCA_POLICY },
    });
    await prisma.season.create({
      data: { leagueId: league.id, name: "2025 Season", slug: "2025-season", year: 2025, scoringPolicy: PCA_POLICY },
    });

    const seasons = await listSeasonsForLeague(prisma, league.id);
    expect(seasons.map((s) => s.year)).toEqual([2026, 2025, 2024]);
  });

  it("breaks a same-year tie by newest id (a Winter Series alongside the main season)", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "list-seasons-tie-test",
        name: "List Seasons Tie Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    const main = await prisma.season.create({
      data: { leagueId: league.id, name: "2026 Season", slug: "2026-season", year: 2026, scoringPolicy: PCA_POLICY },
    });
    const winter = await prisma.season.create({
      data: { leagueId: league.id, name: "2026 Winter Series", slug: "2026-winter-series", year: 2026, scoringPolicy: PCA_POLICY },
    });

    const seasons = await listSeasonsForLeague(prisma, league.id);
    expect(seasons.map((s) => s.id)).toEqual([winter.id, main.id]);
  });

  it("is scoped to the given league", async () => {
    const otherLeague = await prisma.league.create({
      data: {
        slug: "list-seasons-other-league",
        name: "Other",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await prisma.season.create({
      data: { leagueId: otherLeague.id, name: "2026 Season", slug: "2026-season", year: 2026, scoringPolicy: PCA_POLICY },
    });

    const league = await prisma.league.create({
      data: {
        slug: "list-seasons-scope-test",
        name: "Scope Test",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    expect(await listSeasonsForLeague(prisma, league.id)).toEqual([]);
  });
});
