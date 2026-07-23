"use client";

/**
 * Events/Leaderboard nav links, league-context-aware.
 *
 * Inside a league-scoped route (`/l/[slug]/...`) the links stay within that
 * league (`/l/[slug]`, `/l/[slug]/leaderboard`) — otherwise clicking
 * "Leaderboard" from another league's pages would silently jump to the
 * DEFAULT league's standings.
 *
 * Outside `/l/` (legacy context) the links target the DEFAULT league's
 * scoped paths (`/l/<defaultLeagueSlug>`, `/l/<defaultLeagueSlug>/leaderboard`)
 * rather than `/` and `/leaderboard` — ROOT `/` is now always the league
 * gate (see app/page.tsx), so an unscoped "Events" link would otherwise
 * send viewers back to the gate instead of the default league's events.
 * `defaultLeagueSlug` is resolved server-side (HeaderNav) and passed down
 * since this is a client component (needs `usePathname`).
 *
 * Visibility: league-scoped pages gate themselves per-league, so inside
 * `/l/` the links always render; in legacy context the server-computed
 * default-league rule (public mode or member session) applies unchanged.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const linkClass =
  "text-sm text-muted-foreground hover:text-foreground transition-colors";

export function NavResultsLinks({
  showInDefaultContext,
  defaultLeagueSlug,
}: {
  showInDefaultContext: boolean;
  defaultLeagueSlug: string;
}) {
  const pathname = usePathname();
  const leagueMatch = pathname?.match(/^\/l\/([^/]+)/);
  const basePath = leagueMatch ? `/l/${leagueMatch[1]}` : `/l/${defaultLeagueSlug}`;

  if (!leagueMatch && !showInDefaultContext) return null;

  return (
    <>
      <Link href={basePath} className={linkClass}>
        Events
      </Link>
      <Link href={`${basePath}/leaderboard`} className={linkClass}>
        Leaderboard
      </Link>
    </>
  );
}
