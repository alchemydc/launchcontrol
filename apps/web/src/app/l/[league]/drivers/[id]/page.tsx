import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { requireMember } from "@/lib/session";
import { DriverPageView } from "@/app/drivers/[id]/driver-page-view";

export const dynamic = "force-dynamic";

/**
 * League-scoped driver page (Task 20) — driver links from `/l/[league]`
 * leaderboard/event/combined-event pages land here instead of exiting to the
 * legacy global `/drivers/[id]` route, keeping the viewer's league context
 * (subnav, gate) intact. Renders the same `DriverPageView` body as the
 * legacy route, with the league filter locked to this route's league.
 */
export default async function LeagueDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string; id: string }>;
  searchParams: Promise<{ league?: string; season?: string; from?: string; to?: string }>;
}) {
  const { league: leagueSlug, id } = await params;
  const league = await getLeagueConfigForSlug(leagueSlug);
  if (!league) notFound();

  // Gate runs before notFound() so unauth viewers can't probe driver id
  // existence — same ordering as the legacy /drivers/[id] route.
  await requireMember(league, `/l/${leagueSlug}/drivers/${id}`, `/l/${leagueSlug}`);

  const driverId = Number(id);
  if (!Number.isInteger(driverId) || driverId <= 0) notFound();

  const rawSearchParams = await searchParams;

  return (
    <DriverPageView
      driverId={driverId}
      lockedLeagueSlug={leagueSlug}
      basePath={`/l/${leagueSlug}`}
      searchParams={rawSearchParams}
    />
  );
}
