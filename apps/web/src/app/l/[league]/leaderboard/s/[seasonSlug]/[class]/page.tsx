import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { resolveSeasonBySlug } from "@/lib/season-resolve";
import { renderLeagueSeasonLeaderboard } from "../../../render-league-leaderboard";

export const revalidate = 300;

export default async function LeagueLeaderboardClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string; seasonSlug: string; class: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { league: slug, seasonSlug, class: classParam } = await params;
  const { sort } = await searchParams;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();

  const pagePath = `/l/${slug}/leaderboard/s/${seasonSlug}/${classParam}`;
  await gateResultsPage(league, pagePath, `/l/${slug}`);

  const season = await resolveSeasonBySlug(prisma, league.id, seasonSlug);
  if (!season) notFound();

  return renderLeagueSeasonLeaderboard({
    leagueSlug: slug,
    leagueName: league.name,
    season,
    classParam,
    sortBy: sort,
  });
}
