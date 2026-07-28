import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";
import {
  checkLeagueAccess,
  getSession,
  landingReturnTo,
  sanitizeReturnTo,
} from "@/lib/session";
import { EventsHome } from "@/app/_events-home";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

/**
 * League home (Task 5) — the league-scoped equivalent of app/page.tsx,
 * reusing the exact same components (EventsHome, Landing) league-scoped
 * rather than forking them. Mirrors the legacy page's gate logic exactly,
 * parameterized on THIS league's config instead of the deployment default.
 *
 * Task 21: the Events tab is season-scoped via `?season=<slug>`. Resolution
 * (requested slug of THIS league, else the active season; a foreign/stale
 * slug degrades to the active season rather than 404ing) lives inside
 * EventsHome, which reads the param straight off `searchParams`.
 */
export default async function LeagueHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ season?: string; returnTo?: string | string[] }>;
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
  const { season, returnTo: rawReturnTo } = await searchParams;
  // Fall back to THIS league's own home: arriving here by clicking a card on
  // the league grid carries no ?returnTo, and without a fallback the OAuth
  // callback strands the viewer at "/" instead of the league they picked.
  // An explicit, valid ?returnTo (the requireMember bounce-back) still wins.
  const returnTo =
    sanitizeReturnTo(rawReturnTo) ?? landingReturnTo(basePath, season);

  return (
    <Landing
      league={league}
      signedIn={Boolean(session.msrUid)}
      returnTo={returnTo}
    />
  );
}
