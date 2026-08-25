import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { ClassingPageView } from "./classing-page-view";

export const revalidate = 300;

/**
 * League-scoped classing guide. NO gate call, unlike the results routes beside
 * it: the classing table is published rules, not member results (see
 * ClassingPageView's header for the reasoning). `notFound()` here is only for
 * an unknown league slug — a known league with no classing model 404s inside
 * the view.
 */
export default async function LeagueClassingPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { league: leagueSlug } = await params;
  const { season } = await searchParams;
  const league = await getLeagueConfigForSlug(leagueSlug);
  if (!league) notFound();

  return <ClassingPageView league={league} seasonSlug={season} />;
}
