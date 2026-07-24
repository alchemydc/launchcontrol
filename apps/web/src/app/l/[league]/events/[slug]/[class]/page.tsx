import { notFound } from "next/navigation";
import { EventClassPageView } from "@/app/events/[slug]/event-class-page-view";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";

export const revalidate = 300;

export default async function LeagueEventClassPage({
  params,
}: {
  params: Promise<{ league: string; slug: string; class: string }>;
}) {
  const { league: leagueSlug, slug, class: rawClass } = await params;
  const league = await getLeagueConfigForSlug(leagueSlug);
  if (!league) notFound();

  const basePath = `/l/${leagueSlug}`;
  await gateResultsPage(
    league,
    `${basePath}/events/${slug}/${rawClass}`,
    basePath,
  );

  return (
    <EventClassPageView
      leagueId={league.id}
      slug={slug}
      rawClass={rawClass}
      basePath={basePath}
    />
  );
}
