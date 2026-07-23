import { getSession, sanitizeReturnTo } from "@/lib/session";
import { getLeagueConfig } from "@/lib/league-config";
import { EventsHome } from "./_events-home";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; returnTo?: string | string[] }>;
}) {
  const league = await getLeagueConfig();
  if (league.accessGate !== "required") {
    return <EventsHome searchParams={searchParams} />;
  }

  const session = await getSession();
  const { returnTo: rawReturnTo } = await searchParams;
  const returnTo = sanitizeReturnTo(rawReturnTo);

  if (session.isRmrMember) {
    return <EventsHome searchParams={searchParams} />;
  }

  return <Landing signedIn={Boolean(session.msrUid)} returnTo={returnTo} />;
}
