import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { requireMember } from "@/lib/session";
import { CombinedEventPageView } from "@/app/events/combined/[date]/combined-event-view";

export const dynamic = "force-dynamic";

/**
 * League-scoped combined-event page — not explicitly named in the Task 5
 * spec's route list, but added so /l/[league]/events/[slug]'s "part of a
 * combined event" cross-link (rendered whenever a sibling same-date event
 * exists) has somewhere to resolve to within the league instead of 404ing.
 */
export default async function LeagueCombinedEventPage({
  params,
}: {
  params: Promise<{ league: string; date: string }>;
}) {
  const { league: leagueSlug, date } = await params;
  const league = await getLeagueConfigForSlug(leagueSlug);
  if (!league) notFound();

  await requireMember(
    league,
    `/l/${leagueSlug}/events/combined/${date}`,
    `/l/${leagueSlug}`,
  );

  return <CombinedEventPageView league={league} date={date} basePath={`/l/${leagueSlug}`} />;
}
