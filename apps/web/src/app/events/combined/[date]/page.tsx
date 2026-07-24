import { notFound } from "next/navigation";
import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { CombinedEventPageView } from "./combined-event-view";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";

export const revalidate = 300;

export default async function CombinedEventPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  // Gate runs before any validation/data fetch so unauth viewers can't probe
  // valid vs. invalid dates (same pattern as /events/[slug]).
  const league = await getLeagueConfig();
  await gateResultsPage(
    league,
    `/events/combined/${date}`,
    `/l/${league.slug}`,
  );

  // This route serves the deployment's default league (legacy URL —
  // /l/[league]/events/combined/[date] is the league-scoped equivalent).
  // CombinedEventPageView scopes its lookup by `league.id` so a different
  // league's event on this date can never be pulled into these results.
  if (!league) notFound();

  return (
    <>
      <DefaultLeagueSubnav />
      <CombinedEventPageView league={league} date={date} />
    </>
  );
}
