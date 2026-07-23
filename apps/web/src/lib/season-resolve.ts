import type { Prisma, PrismaClient, Season } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";

/**
 * Resolve the (league, year) Season row, auto-creating a bare one if none
 * exists yet. Shared by ingestAxdb's ingest-time resolution (ingest.ts) and
 * updateEventMetadata's cross-year re-resolution (admin-events.ts), so both
 * follow the same deterministic rule.
 *
 * `orderBy: { id: "asc" }` makes the (league, year) lookup deterministic now
 * that `createSeason` allows multiple seasons per (league, year) — season-
 * aware addressing (`resolveSeasonBySlug`, `activeSeason` below) is how
 * callers pick a specific one; this ingest-time/admin-edit path always keeps
 * picking the oldest, matching pre-PR-2 behavior when only one existed.
 *
 * The auto-created row snapshots the league's OLDEST ScoringSystem preset
 * (deterministic; seeded leagues carry exactly one) rather than any
 * hardcoded policy, so a league with a non-default preset self-heals
 * correctly too. It carries plannedEvents=0 until an operator edits it (via
 * create-season or a future admin UI) — neither ingest nor an admin date
 * edit has a signal for the season's actual event count.
 */
export async function resolveOrCreateSeason(
  client: PrismaClient | Prisma.TransactionClient,
  league: { id: number; slug: string },
  year: number,
): Promise<Season> {
  const existing = await client.season.findFirst({
    where: { leagueId: league.id, year },
    orderBy: { id: "asc" },
  });
  if (existing) return existing;

  const preset = await client.scoringSystem.findFirst({
    where: { leagueId: league.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!preset) {
    throw new Error(
      `[season-resolve] league '${league.slug}' has no ScoringSystem presets — create a scoring system for league '${league.slug}' first (e.g. 'pnpm --filter web season:create').`,
    );
  }

  const name = `${year} Season`;
  const slug = slugify(name);

  // Guard against the auto-create slug colliding with an operator-created
  // season for a DIFFERENT year (e.g. a custom-named season whose slugified
  // form happens to match "<year> Season"'s slug) — without this check the
  // create() below fails with a raw Prisma P2002 on the (leagueId, slug)
  // unique index, which is useless to an operator watching ingest logs.
  const slugCollision = await client.season.findFirst({ where: { leagueId: league.id, slug } });
  if (slugCollision) {
    throw new Error(
      `[season-resolve] cannot auto-create a ${year} season for league '${league.slug}': ` +
        `slug '${slug}' is already used by season '${slugCollision.name}' ` +
        `(id=${slugCollision.id}, year=${slugCollision.year}). Create the ${year} season ` +
        `explicitly with an unambiguous --slug (or --name) via 'season:create'.`,
    );
  }

  return client.season.create({
    data: {
      leagueId: league.id,
      name,
      slug,
      year,
      plannedEvents: 0,
      scoringPolicy: preset.policy,
    },
  });
}

/**
 * Resolve a Season by its (league, slug) addressing key — the lookup public
 * browsing routes use (see docs/superpowers/specs/2026-07-23-league-multiclub-design.md
 * "Season addressing"). Returns null rather than throwing on a miss so
 * callers can 404 rather than 500.
 */
export async function resolveSeasonBySlug(
  client: PrismaClient | Prisma.TransactionClient,
  leagueId: number,
  slug: string,
): Promise<Season | null> {
  return client.season.findFirst({ where: { leagueId, slug } });
}

/**
 * List every Season row under a league, newest-first (year desc, ties by id
 * desc — same ordering convention as `activeSeason`). Powers the season
 * switcher on public browsing routes (Task 5's `/l/[league]/leaderboard*`),
 * which addresses seasons by slug and labels them by name rather than by
 * bare year (a league can have more than one season per year, e.g. a Winter
 * Series alongside the main season).
 */
export async function listSeasonsForLeague(
  client: PrismaClient | Prisma.TransactionClient,
  leagueId: number,
): Promise<Array<Pick<Season, "id" | "slug" | "name" | "year" | "status">>> {
  return client.season.findMany({
    where: { leagueId },
    orderBy: [{ year: "desc" }, { id: "desc" }],
    select: { id: true, slug: true, name: true, year: true, status: true },
  });
}

/**
 * The league's "active" season for default (no-seasonSlug) URLs: status
 * "active", newest year, ties broken by newest id (matches the id-asc
 * determinism convention used elsewhere in this file). Returns null for a
 * league with no active seasons at all.
 */
export async function activeSeason(
  client: PrismaClient | Prisma.TransactionClient,
  leagueId: number,
): Promise<Season | null> {
  return client.season.findFirst({
    where: { leagueId, status: "active" },
    orderBy: [{ year: "desc" }, { id: "desc" }],
  });
}
