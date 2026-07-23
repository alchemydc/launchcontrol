/**
 * iron-session typed wrappers for Launch Control.
 *
 * Two cookies:
 *   lc_session      — main session (30 days). Stores the six SessionData fields.
 *   lc_msr_req      — transient request-token cookie (10 min, path-scoped to
 *                     the callback route). Stashes oauth_token_secret between
 *                     /api/auth/msr/login and /api/auth/msr/callback.
 *
 * PII rule: full lastName is NEVER stored here. The callback route applies
 * redactLastName() and stores only lastInitial.
 */

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLeagueConfig } from "@/lib/league-config";

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
  returnTo?: string;
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

// ---------------------------------------------------------------------------
// sanitizeReturnTo — strict open-redirect validator
//
// Returns the sanitized path string, or null if the value is unsafe/invalid.
// Callers should fall back to "/" when null is returned.
// ---------------------------------------------------------------------------

export function sanitizeReturnTo(raw: string | string[] | null | undefined): string | null {
  if (Array.isArray(raw)) return null;
  if (!raw || raw.length < 1 || raw.length > 512) return null;

  // Reject control chars, whitespace, backslashes, and percent-encoded control
  // chars (%00–%1f, %7f) before any further parsing.
  if (/[\x00-\x1f\x7f\s\\]/.test(raw)) return null;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)) return null;

  // Must start with exactly "/" and second char must not be "/" or "\" (blocks //evil.com and /\evil.com).
  if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\") return null;

  // Parse via URL to normalize; reject if the host is anything other than the placeholder.
  let url: URL;
  try {
    url = new URL(raw, "http://placeholder");
  } catch {
    return null;
  }
  if (url.host !== "placeholder") return null;

  // Reconstruct without fragment; re-check the leading-slash invariant on the result.
  const result = url.pathname + url.search;
  if (!result.startsWith("/") || result[1] === "/" || result[1] === "\\") return null;

  return result;
}

// ---------------------------------------------------------------------------
// requireRmrMember — page-level gate
//
// Callers MUST NOT wrap this in try/catch — redirect() throws NEXT_REDIRECT.
// Gate runs before any data fetch so unauthorized viewers cannot probe slug
// existence via 404 vs redirect behavior.
// ---------------------------------------------------------------------------

export async function requireRmrMember(
  returnPath?: string
): Promise<{ session: IronSession<SessionData> | null }> {
  // Public deployments (accessGate optional|none) never gate results pages.
  const league = await getLeagueConfig();
  if (league.accessGate !== "required") {
    if (!process.env.SESSION_SECRET) {
      // No sessions configured at all (login disabled) — nothing to gate with.
      return { session: null };
    }
    return { session: await getSession() };
  }

  const session = await getSession();

  if (!session.msrUid || !session.isRmrMember) {
    const safe = returnPath ? sanitizeReturnTo(returnPath) : null;
    redirect(safe ? `/?returnTo=${encodeURIComponent(safe)}` : "/");
  }

  return { session };
}
