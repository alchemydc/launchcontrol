import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { EventClassPageView } from "../event-class-page-view";

export const revalidate = 300;

export default async function EventClassPage({
  params,
}: {
  params: Promise<{ slug: string; class: string }>;
}) {
  const { slug, class: rawClass } = await params;
  const league = await getLeagueConfig();
  await gateResultsPage(
    league,
    `/events/${slug}/${rawClass}`,
    `/l/${league.slug}`,
  );

  return (
    <>
      <DefaultLeagueSubnav />
      <EventClassPageView
        leagueId={league.id}
        slug={slug}
        rawClass={rawClass}
      />
    </>
  );
}
