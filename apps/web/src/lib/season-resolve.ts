import { cache } from "react";
import type { Prisma, PrismaClient, Season } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";

/**
 * Resolve the (league, year) Season row, auto-creating a bare one if none
 * exists yet. Shared by ingestAxdb's ingest-time resolution (ingest.ts) and
 * updateEventMetadata's cross-year re-resolution (admin-events.ts), so both
 * follow the same deterministic rule.
 *
 * Ingest lands results in the year's ACTIVE season — archived ("completed")
 * seasons only receive ingests when the year has no active season at all, in
 * which case this falls back to the oldest season overall (`orderBy: { id:
 * "asc" }`), matching pre-PR-2 behavior when only one season existed for the
 * year. Multiple seasons per (league, year) are a supported feature (e.g. a
 * Winter Series alongside the main season) — and for exactly that reason,
 * when MORE THAN ONE active season matches the year this THROWS instead of
 * guessing (PR #99 review: a silent lowest-id pick could land a main-series
 * event under the Winter series' ruleset). Callers escape the ambiguity by
 * passing an explicit season slug (CLI `--season`, `seasonSlug` on the
 * ingest inputs), resolved via `resolveSeasonBySlug` before ever reaching
 * this function.
 *
 * The auto-created row adopts the league's OLDEST ScoringSystem ruleset
 * (deterministic; seeded leagues carry exactly one) as a LIVE reference
 * (`rulesetId` — no policy copy is stored on the Season since Task R2), so a
 * league with a non-default ruleset self-heals correctly too. It carries
 * plannedEvents=0 until an operator edits it (via create-season or a future
 * admin UI) — neither ingest nor an admin date edit has a signal for the
 * season's actual event count.
 */
export async function resolveOrCreateSeason(
  client: PrismaClient | Prisma.TransactionClient,
  league: { id: number; slug: string },
  year: number,
): Promise<Season> {
  const activeMatches = await client.season.findMany({
    where: { leagueId: league.id, year, status: "active" },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (activeMatches.length > 1) {
    const candidates = await client.season.findMany({
      where: { leagueId: league.id, year, status: "active" },
      orderBy: { id: "asc" },
      select: { slug: true, name: true },
    });
    throw new Error(
      `[season-resolve] league '${league.slug}' has ${candidates.length} active seasons for ${year} ` +
        `(${candidates.map((s) => `'${s.slug}'`).join(", ")}) — pass an explicit season ` +
        `(e.g. ingest --season <slug>) so results can't land under the wrong ruleset.`,
    );
  }
  const existing =
    activeMatches[0] ??
    (await client.season.findFirst({
      where: { leagueId: league.id, year },
      orderBy: { id: "asc" },
    }));
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
      rulesetId: preset.id,
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

export type SeasonOption = Pick<Season, "id" | "slug" | "name" | "year" | "status">;

/**
 * List every Season row under a league, newest-first (year desc, ties by id
 * desc — same ordering convention as `activeSeason`). Powers the season
 * switcher on public browsing routes (Task 5's `/l/[league]/leaderboard*`),
 * which addresses seasons by slug and labels them by name rather than by
 * bare year (a league can have more than one season per year, e.g. a Winter
 * Series alongside the main season).
 *
 * Memoized per (client, leagueId) via React `cache()` so a `/l/[league]/*`
 * render tree issues ONE Season read instead of one per component: the layout
 * needs the list for the season switcher, and the page then derives the season
 * it is rendering from that same list via `pickActiveSeason` /
 * `pickSeasonBySlug` rather than re-querying. Same pattern as
 * `getLeagueConfigForSlug`.
 */
export const listSeasonsForLeague = cache(
  async (
    client: PrismaClient | Prisma.TransactionClient,
    leagueId: number,
  ): Promise<SeasonOption[]> =>
    client.season.findMany({
      where: { leagueId },
      orderBy: [{ year: "desc" }, { id: "desc" }],
      select: { id: true, slug: true, name: true, year: true, status: true },
    }),
);

/**
 * In-memory equivalents of `activeSeason` / `resolveSeasonBySlug` for callers
 * that already hold a `listSeasonsForLeague` result — they save a round trip
 * each, which matters because every Prisma call is a network hop to Turso.
 *
 * `pickActiveSeason` is an exact match for `activeSeason`'s semantics rather
 * than a re-implementation of them: `listSeasonsForLeague` already sorts by
 * [year desc, id desc], the very ordering `activeSeason` applies, so the first
 * "active" row in that list IS the row the query would return.
 *
 * `pickSeasonBySlug` relies on slug being unique within a league (the
 * `@@unique([leagueId, slug])` the query form's `findFirst` also assumes).
 *
 * The query forms stay for callers that hold only a `leagueId` and for ingest,
 * which resolves inside a transaction and must read live.
 */
export function pickActiveSeason(seasons: SeasonOption[]): SeasonOption | null {
  return seasons.find((s) => s.status === "active") ?? null;
}

export function pickSeasonBySlug(
  seasons: SeasonOption[],
  slug: string,
): SeasonOption | null {
  return seasons.find((s) => s.slug === slug) ?? null;
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
