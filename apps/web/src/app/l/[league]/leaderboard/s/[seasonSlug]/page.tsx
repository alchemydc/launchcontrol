import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { requireMember } from "@/lib/session";
import { resolveSeasonBySlug } from "@/lib/season-resolve";
import { renderLeagueSeasonLeaderboard } from "../../render-league-leaderboard";

export const dynamic = "force-dynamic";

/**
 * Season-addressed leaderboard (Task 5): `/l/[league]/leaderboard/s/[slug]`.
 * Unlike the legacy `/leaderboard/[year]` (bare year, id-asc tiebreak within
 * a year), this addresses one specific Season row directly by its slug — a
 * league can have more than one season per year (e.g. a Winter Series).
 */
export default async function LeagueLeaderboardSeasonPage({
  params,
}: {
  params: Promise<{ league: string; seasonSlug: string }>;
}) {
  const { league: slug, seasonSlug } = await params;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();

  // Gate runs before the season-slug lookup so unauth viewers can't probe
  // valid vs. invalid season slugs via 404 vs redirect behavior.
  await requireMember(league, `/l/${slug}/leaderboard/s/${seasonSlug}`, `/l/${slug}`);

  const season = await resolveSeasonBySlug(prisma, league.id, seasonSlug);
  if (!season) notFound();

  return renderLeagueSeasonLeaderboard({
    leagueId: league.id,
    leagueName: league.name,
    leagueSlug: slug,
    season,
  });
}
