import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import { checkLeagueAccess, getSession, sanitizeReturnTo } from "@/lib/session";
import { EventsHome } from "@/app/_events-home";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

/**
 * League home (Task 5) — the league-scoped equivalent of app/page.tsx,
 * reusing the exact same components (EventsHome, Landing) league-scoped
 * rather than forking them. Mirrors the legacy page's gate logic exactly,
 * parameterized on THIS league's config instead of the deployment default.
 */
export default async function LeagueHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ year?: string; returnTo?: string | string[] }>;
}) {
  const { league: slug } = await params;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();

  const basePath = `/l/${slug}`;

  if (league.accessGate !== "required") {
    return (
      <EventsHome
        searchParams={searchParams}
        leagueId={league.id}
        basePath={basePath}
        smugmugTarget={league}
        subtitle={league.siteDescription}
      />
    );
  }

  // Required gate: membership decision (superuser / role / org match) via the
  // shared wrapper, not a raw session flag — same rule requireMember enforces
  // on the league's inner pages, so home and inner pages agree on who's in.
  if ((await checkLeagueAccess(league)) === "allow") {
    return (
      <EventsHome
        searchParams={searchParams}
        leagueId={league.id}
        basePath={basePath}
        smugmugTarget={league}
        subtitle={league.siteDescription}
      />
    );
  }

  const session = await getSession();
  const { returnTo: rawReturnTo } = await searchParams;
  const returnTo = sanitizeReturnTo(rawReturnTo);

  return (
    <Landing
      league={league}
      signedIn={Boolean(session.msrUid)}
      returnTo={returnTo}
    />
  );
}
