"use client";

/**
 * Events/Leaderboard nav links, league-context-aware.
 *
 * Inside a league-scoped route (`/l/[slug]/...`) the links stay within that
 * league (`/l/[slug]`, `/l/[slug]/leaderboard`) — otherwise clicking
 * "Leaderboard" from another league's pages would silently jump to the
 * DEFAULT league's standings. Outside `/l/` the links keep their legacy
 * targets (`/`, `/leaderboard`), which serve the default league.
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
}: {
  showInDefaultContext: boolean;
}) {
  const pathname = usePathname();
  const leagueMatch = pathname?.match(/^\/l\/([^/]+)/);
  const basePath = leagueMatch ? `/l/${leagueMatch[1]}` : "";

  if (!leagueMatch && !showInDefaultContext) return null;

  return (
    <>
      <Link href={basePath || "/"} className={linkClass}>
        Events
      </Link>
      <Link href={`${basePath}/leaderboard`} className={linkClass}>
        Leaderboard
      </Link>
    </>
  );
}
