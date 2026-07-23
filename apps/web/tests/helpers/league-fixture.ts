import type { PrismaClient } from "@/generated/prisma/client";

// Fixture DBs run `prisma migrate deploy`, which seeds the "pca-rmr" League
// row unconditionally (see the league-foundation migration) but seeds a
// Season row only for years that already have Event rows at migration time —
// never true for a fixture DB migrated before any ingest. `ingestAxdb` fills
// that gap for years it actually ingests into (auto-creating a bare
// plannedEvents=0 Season), but tests that need a Season row for a year with
// no fixture events at all (e.g. an empty-year test) need one created
// directly. This helper does that, and also lets tests pin `plannedEvents`
// on a season without hand-rolling the League/Season shape everywhere.

export const DEFAULT_LEAGUE_SLUG = "pca-rmr";

// Matches the "PCA Classic" preset seeded by the league-foundation migration
// and the bare-Season default `ingestAxdb` auto-creates (apps/web/src/lib/ingest.ts).
export const DEFAULT_SCORING_POLICY =
  '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';

export type SeasonFixtureSpec = {
  year: number;
  plannedEvents?: number;
  name?: string;
};

export type LeagueFixtureResult = {
  leagueId: number;
  seasonIdByYear: Map<number, number>;
};

/**
 * Ensure a League row (default slug "pca-rmr") and one Season row per given
 * year exist in `client`'s DB, creating only what's missing — a Season row
 * `ingestAxdb` already auto-created for that (league, year) is left as-is.
 * Accepts either a bare year (plannedEvents defaults to 0, matching the
 * ingest auto-create default) or a `{ year, plannedEvents, name }` spec.
 */
export async function ensureLeagueAndSeasons(
  client: PrismaClient,
  years: Array<number | SeasonFixtureSpec>,
  leagueSlug: string = DEFAULT_LEAGUE_SLUG,
): Promise<LeagueFixtureResult> {
  let league = await client.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) {
    league = await client.league.create({
      data: {
        slug: leagueSlug,
        name: "PCA Rocky Mountain Region",
        siteTitle: "Launch Control · PCA RMR",
        siteDescription:
          "Rocky Mountain Region autocross results, calendar, and community media.",
        footerText: "Built for PCA Rocky Mountain Region · Autocross results from VisualAX",
        landingDescription:
          "Sign in with your MotorsportReg account to access Rocky Mountain Region autocross results, sortable event leaderboards, season standings, and driver profiles.",
        accessGate: "required",
      },
    });
  }

  const seasonIdByYear = new Map<number, number>();
  for (const spec of years) {
    const { year, plannedEvents = 0, name } =
      typeof spec === "number" ? { year: spec, plannedEvents: 0, name: undefined } : spec;

    let season = await client.season.findFirst({ where: { leagueId: league.id, year } });
    if (!season) {
      season = await client.season.create({
        data: {
          leagueId: league.id,
          name: name ?? `${year} Season`,
          year,
          plannedEvents,
          scoringPolicy: DEFAULT_SCORING_POLICY,
        },
      });
    }
    seasonIdByYear.set(year, season.id);
  }

  return { leagueId: league.id, seasonIdByYear };
}
