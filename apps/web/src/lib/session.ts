/**
 * iron-session typed wrappers for Launch Control.
 *
 * Two cookies:
 *   lc_session      — main session (30 days). Stores the seven SessionData fields.
 *   lc_msr_req      — transient request-token cookie (10 min, path-scoped to
 *                     the callback route). Stashes oauth_token_secret between
 *                     /api/auth/msr/login and /api/auth/msr/callback.
 *
 * PII rule: full lastName is NEVER stored here. The callback route applies
 * redactLastName() and stores only lastInitial.
 */

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// SESSION_SECRET is checked lazily on first use — not at module load — so
// `next build` (which evaluates every route handler module to collect page
// data) does not require the secret to be present in the build environment.
// ---------------------------------------------------------------------------

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET environment variable must be set and at least 32 characters long"
    );
  }
  return secret;
}

const isProd = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// SessionData — main session cookie payload
// ---------------------------------------------------------------------------

export interface SessionData {
  /** MSR UID (UUID, uppercase hex with dashes). */
  msrUid?: string;
  firstName?: string;
  /** First character of last name followed by period, e.g. "S." — never full last name. */
  lastInitial?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  isRmrMember?: boolean;
}

// ---------------------------------------------------------------------------
// RequestTokenSessionData — transient cookie between login and callback
// ---------------------------------------------------------------------------

export interface RequestTokenSessionData {
  oauthTokenSecret?: string;
}

// ---------------------------------------------------------------------------
// getSession — main session (30 days)
// ---------------------------------------------------------------------------

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, {
    cookieName: "lc_session",
    password: getSessionSecret(),
    cookieOptions: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    },
  });
}

// ---------------------------------------------------------------------------
// getRequestTokenSession — transient cookie (10 min, callback path only)
// ---------------------------------------------------------------------------

export async function getRequestTokenSession() {
  const cookieStore = await cookies();
  return getIronSession<RequestTokenSessionData>(cookieStore, {
    cookieName: "lc_msr_req",
    password: getSessionSecret(),
    cookieOptions: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/api/auth/msr/callback",
    },
  });
}
