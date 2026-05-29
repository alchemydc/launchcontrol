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
import { isAdmin } from "@/lib/admin";

const linkClass =
  "text-sm text-muted-foreground hover:text-foreground transition-colors";

export async function HeaderNav() {
  const session = await getSession();
  const isSignedIn = Boolean(session.msrUid);
  const displayName = isSignedIn
    ? `${session.firstName ?? ""} ${session.lastInitial ?? ""}`.trim()
    : null;
  const showAdmin = isAdmin(session.msrUid);

  return (
    <nav className="flex items-center gap-4">
      <Link href="/" className={linkClass}>
        Events
      </Link>
      <Link href="/leaderboard" className={linkClass}>
        Leaderboard
      </Link>
      {showAdmin && (
        <Link href="/admin" className={linkClass}>
          Admin
        </Link>
      )}
      {isSignedIn ? (
        <Link href="/me" className={linkClass}>
          {displayName}
        </Link>
      ) : (
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      )}
    </nav>
  );
}
