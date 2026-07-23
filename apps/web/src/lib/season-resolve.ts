import type { Prisma, PrismaClient, Season } from "@/generated/prisma/client";

/**
 * Resolve the (league, year) Season row, auto-creating a bare one if none
 * exists yet. Shared by ingestAxdb's ingest-time resolution (ingest.ts) and
 * updateEventMetadata's cross-year re-resolution (admin-events.ts), so both
 * follow the same deterministic rule.
 *
 * `orderBy: { id: "asc" }` makes the (league, year) lookup deterministic if a
 * league ever ends up with more than one Season row for the same year (not
 * possible via `createSeason`, which refuses duplicates, but not enforced at
 * the DB level — see schema.prisma `Season.@@unique([leagueId, name])`,
 * which does not cover `year`).
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

  return client.season.create({
    data: {
      leagueId: league.id,
      name: `${year} Season`,
      year,
      plannedEvents: 0,
      scoringPolicy: preset.policy,
    },
  });
}
