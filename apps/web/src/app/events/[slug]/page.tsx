import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveLeague } from "@/lib/league-config";
import { requireRmrMember } from "@/lib/session";
import { EventPageView } from "./event-page-view";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Gate runs before notFound() so unauth viewers can't probe slug existence.
  await requireRmrMember(`/events/${slug}`);

  // This route serves the deployment's default league (legacy URL —
  // /l/[league]/events/[slug] is the league-scoped equivalent). EventPageView
  // scopes its lookup by `league.id` (Event.slug is only unique per-season)
  // so a same-slug event in a different league can never cross-resolve here.
  const league = await resolveLeague(undefined, prisma);
  if (!league) notFound();

  return (
    <>
      <DefaultLeagueSubnav />
      <EventPageView league={league} slug={slug} />
    </>
  );
}
