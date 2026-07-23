import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveLeague } from "@/lib/league-config";
import { requireRmrMember } from "@/lib/session";
import { CombinedEventPageView } from "./combined-event-view";

export const dynamic = "force-dynamic";

export default async function CombinedEventPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  // Gate runs before any validation/data fetch so unauth viewers can't probe
  // valid vs. invalid dates (same pattern as /events/[slug]).
  await requireRmrMember(`/events/combined/${date}`);

  // This route serves the deployment's default league (legacy URL —
  // /l/[league]/events/combined/[date] is the league-scoped equivalent).
  // CombinedEventPageView scopes its lookup by `league.id` so a different
  // league's event on this date can never be pulled into these results.
  const league = await resolveLeague(undefined, prisma);
  if (!league) notFound();

  return <CombinedEventPageView league={league} date={date} />;
}
