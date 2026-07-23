import { getSession, sanitizeReturnTo } from "@/lib/session";
import { getLeagueConfig, shouldShowLeagueGate } from "@/lib/league-config";
import { EventsHome } from "./_events-home";
import { Landing } from "@/components/landing";
import { LeagueGate } from "@/components/league-gate";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; returnTo?: string | string[] }>;
}) {
  // Multi-league deployments: ROOT `/` becomes the league gate (card grid)
  // instead of the default league's home. Single-league deployments (e.g.
  // PCA production) fall through unchanged — byte-parity with pre-gate `/`.
  if (await shouldShowLeagueGate()) {
    return <LeagueGate />;
  }

  const league = await getLeagueConfig();
  if (league.accessGate !== "required") {
    return <EventsHome searchParams={searchParams} leagueId={league.id} />;
  }

  const session = await getSession();
  const { returnTo: rawReturnTo } = await searchParams;
  const returnTo = sanitizeReturnTo(rawReturnTo);

  if (session.isRmrMember) {
    return <EventsHome searchParams={searchParams} leagueId={league.id} />;
  }

  return <Landing signedIn={Boolean(session.msrUid)} returnTo={returnTo} />;
}
