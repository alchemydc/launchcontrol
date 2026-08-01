import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { listSeasonsForLeague, pickActiveSeason } from "@/lib/season-resolve";
import { renderLeagueSeasonLeaderboard } from "./render-league-leaderboard";

export const revalidate = 300;

/**
 * Bare /l/[league]/leaderboard — the league's active season (spec: status
 * "active", newest year, tie newest id). /l/[league]/leaderboard/s/[slug]
 * is the season-addressed equivalent (Task 5).
 */
export default async function LeagueLeaderboardPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league: slug } = await params;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();

  // Gate runs before season resolution so unauth viewers can't probe this
  // league's data (same ordering as the legacy /leaderboard pages).
  await gateResultsPage(league, `/l/${slug}/leaderboard`, `/l/${slug}`);

  // Shares the layout's memoized season list rather than re-querying.
  const season = pickActiveSeason(await listSeasonsForLeague(prisma, league.id));

  return renderLeagueSeasonLeaderboard({
    leagueSlug: slug,
    leagueName: league.name,
    season,
  });
}
