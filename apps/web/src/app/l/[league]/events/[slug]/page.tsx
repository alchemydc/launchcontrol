import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { EventPageView } from "@/app/events/[slug]/event-page-view";

export const revalidate = 300;

export default async function LeagueEventPage({
  params,
}: {
  params: Promise<{ league: string; slug: string }>;
}) {
  const { league: leagueSlug, slug } = await params;
  const league = await getLeagueConfigForSlug(leagueSlug);
  if (!league) notFound();

  // Gate runs before EventPageView's notFound() so unauth viewers can't
  // probe slug existence.
  await gateResultsPage(
    league,
    `/l/${leagueSlug}/events/${slug}`,
    `/l/${leagueSlug}`,
  );

  return <EventPageView league={league} slug={slug} basePath={`/l/${leagueSlug}`} />;
}
