import type { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";
import { RMSOLO_PAX_2026 } from "@/lib/rmsolo-pax";

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

// Matches the "PCA Classic" ruleset seeded by the league-foundation migration
// (canonicalized to v4 by scoring_policy_v4) — the policy every fixture season
// scores with unless a test points it at a different ruleset.
export const DEFAULT_SCORING_POLICY =
  '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
  '"points":{"type":"ratio1000","basis":"class"}}';

/**
 * Return a ScoringSystem id usable as a Season.rulesetId for `leagueId` —
 * the league's oldest existing ruleset (the seeded "PCA Classic" on migrated
 * fixture DBs) unless any override is given, in which case a new ruleset row
 * is created with the given name/policy/paxTable (defaults mirroring
 * `createLeague`'s default ruleset seed).
 */
export async function ensureRuleset(
  client: PrismaClient,
  leagueId: number,
  opts: { name?: string; policy?: string; paxTable?: string } = {},
): Promise<number> {
  if (opts.name === undefined && opts.policy === undefined && opts.paxTable === undefined) {
    const existing = await client.scoringSystem.findFirst({
      where: { leagueId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (existing) return existing.id;
  }
  const created = await client.scoringSystem.create({
    data: {
      leagueId,
      name: opts.name ?? `Test Ruleset ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      policy: opts.policy ?? DEFAULT_SCORING_POLICY,
      paxTable: opts.paxTable ?? JSON.stringify(RMSOLO_PAX_2026),
    },
  });
  return created.id;
}

export type SeasonFixtureSpec = {
  year: number;
  plannedEvents?: number;
  minimumEvents?: number;
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
 * Accepts either a bare year (plannedEvents defaults to 0 and minimumEvents
 * defaults to 4, matching Season defaults) or a
 * `{ year, plannedEvents, minimumEvents, name }` spec.
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

  // Seasons need a ruleset to reference (required rulesetId FK) — reuse the
  // league's oldest ScoringSystem (the seeded "PCA Classic" for migrated
  // fixture DBs), creating a default one only for a league that has none
  // (same shape `createLeague` seeds).
  let ruleset = await client.scoringSystem.findFirst({
    where: { leagueId: league.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!ruleset) {
    ruleset = await client.scoringSystem.create({
      data: {
        leagueId: league.id,
        name: `${league.name} Default`,
        policy: DEFAULT_SCORING_POLICY,
        // COMPLETE table, same as createLeague's default ruleset seed.
        paxTable: JSON.stringify(RMSOLO_PAX_2026),
      },
    });
  }

  const seasonIdByYear = new Map<number, number>();
  for (const spec of years) {
    const { year, plannedEvents = 0, minimumEvents = 4, name } =
      typeof spec === "number"
        ? { year: spec, plannedEvents: 0, minimumEvents: 4, name: undefined }
        : spec;

    let season = await client.season.findFirst({ where: { leagueId: league.id, year } });
    if (!season) {
      const seasonName = name ?? `${year} Season`;
      season = await client.season.create({
        data: {
          leagueId: league.id,
          name: seasonName,
          slug: slugify(seasonName),
          year,
          plannedEvents,
          minimumEvents,
          rulesetId: ruleset.id,
        },
      });
    }
    seasonIdByYear.set(year, season.id);
  }

  return { leagueId: league.id, seasonIdByYear };
}
