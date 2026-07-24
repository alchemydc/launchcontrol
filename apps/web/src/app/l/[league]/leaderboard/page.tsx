import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { requireMember } from "@/lib/session";
import { activeSeason } from "@/lib/season-resolve";
import { renderLeagueSeasonLeaderboard } from "./render-league-leaderboard";

export const dynamic = "force-dynamic";

/**
 * Bare /l/[league]/leaderboard — the league's active season (spec: status
 * "active", newest year, tie newest id). /l/[league]/leaderboard/s/[slug]
 * is the season-addressed equivalent (Task 5).
 */
export default async function LeagueLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ class?: string; sort?: string }>;
}) {
  const { league: slug } = await params;
  const { class: activeClassCode, sort } = await searchParams;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();

  // Gate runs before season resolution so unauth viewers can't probe this
  // league's data (same ordering as the legacy /leaderboard pages).
  await requireMember(league, `/l/${slug}/leaderboard`, `/l/${slug}`);

  const season = await activeSeason(prisma, league.id);

  return renderLeagueSeasonLeaderboard({
    leagueSlug: slug,
    leagueName: league.name,
    season,
    activeClassCode,
    sortBy: sort,
  });
}
