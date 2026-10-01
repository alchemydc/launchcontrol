import { notFound } from "next/navigation";
import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { EventPageView } from "./event-page-view";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { connection } from "next/server";

export const instant = false;

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;

  // Gate runs before notFound() so unauth viewers can't probe slug existence.
  const league = await getLeagueConfig();
  await gateResultsPage(league, `/events/${slug}`, `/l/${league.slug}`);

  if (!league) notFound();

  return (
    <>
      <DefaultLeagueSubnav />
      <EventPageView league={league} slug={slug} />
    </>
  );
}
