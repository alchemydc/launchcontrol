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
import { getClubConfig } from "@/lib/club-config";
import { isAdmin } from "@/lib/admin";

const linkClass =
  "text-sm text-muted-foreground hover:text-foreground transition-colors";

export async function HeaderNav() {
  const club = getClubConfig();
  const publicMode = club.accessGate !== "required";
  // Guard session read for secret-less public deploys. Required-mode deploys
  // always read the session (member gating depends on it); public deploys
  // only read it when login is actually enabled.
  const session =
    !publicMode || club.loginEnabled ? await getSession() : null;
  const isSignedIn = Boolean(session?.msrUid);
  const displayName = isSignedIn
    ? `${session!.firstName ?? ""} ${session!.lastInitial ?? ""}`.trim()
    : null;
  const showAdmin = isAdmin(session?.msrUid);
  const showResultsLinks = publicMode || Boolean(session?.isRmrMember);

  return (
    <nav className="flex flex-wrap items-center gap-3 sm:gap-4">
      {showResultsLinks && (
        <Link href="/" className={linkClass}>
          Events
        </Link>
      )}
      {showResultsLinks && (
        <Link href="/leaderboard" className={linkClass}>
          Leaderboard
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
      {!isSignedIn && (club.loginEnabled || club.accessGate === "required") && (
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      )}
    </nav>
  );
}
