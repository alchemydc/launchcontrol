/**
 * HeaderNav — server component.
 *
 * Renders the site nav links plus a session-aware sign-in/out affordance.
 * Extracted from app/layout.tsx so layout.tsx stays a clean shell.
 *
 * Signed in:  "${firstName} ${lastInitial}" → /me
 * Signed out: "Sign in" → /login
 */

import Link from "next/link";
import { getSession } from "@/lib/session";
import { getLeagueConfig, countLeagues } from "@/lib/league-config";
import { isAdmin } from "@/lib/admin";
import { NavResultsLinks } from "@/components/nav-results-links";

const linkClass =
  "text-sm text-muted-foreground hover:text-foreground transition-colors";

export async function HeaderNav() {
  const league = await getLeagueConfig();
  const publicMode = league.accessGate !== "required";
  // Guard session read for secret-less public deploys. Required-mode deploys
  // always read the session (member gating depends on it); public deploys
  // only read it when login is actually enabled.
  const session =
    !publicMode || league.loginEnabled ? await getSession() : null;
  const isSignedIn = Boolean(session?.msrUid);
  const displayName = isSignedIn
    ? `${session!.firstName ?? ""} ${session!.lastInitial ?? ""}`.trim()
    : null;
  const showAdmin = await isAdmin(session?.msrUid);
  const showResultsLinks = publicMode || Boolean(session?.isRmrMember);
  // "Leagues" only appears once a second league exists — single-league
  // deployments (PCA production) see zero nav change (Task 5).
  const showLeaguesLink = (await countLeagues()) > 1;

  return (
    <nav className="flex flex-wrap items-center gap-3 sm:gap-4">
      <NavResultsLinks
        showInDefaultContext={showResultsLinks}
        defaultLeagueSlug={league.slug}
      />
      {showLeaguesLink && (
        <Link href="/leagues" className={linkClass}>
          Leagues
        </Link>
      )}
      {showAdmin && (
        <Link href="/admin" className={linkClass}>
          Admin
        </Link>
      )}
      {isSignedIn && (
        <Link href="/me" className={linkClass}>
          {displayName}
        </Link>
      )}
      {!isSignedIn && (league.loginEnabled || league.accessGate === "required") && (
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      )}
    </nav>
  );
}
