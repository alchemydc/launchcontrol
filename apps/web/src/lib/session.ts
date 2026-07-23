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
import { getLeagueConfig, type AccessGate } from "@/lib/league-config";

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
// requireMember / requireRmrMember — page-level gate
//
// Callers MUST NOT wrap this in try/catch — redirect() throws NEXT_REDIRECT.
// Gate runs before any data fetch so unauthorized viewers cannot probe slug
// existence via 404 vs redirect behavior.
// ---------------------------------------------------------------------------

/**
 * Pure gate-selection decision behind `requireMember`: given a league's
 * accessGate and the session fields membership depends on, decide whether
 * the viewer is let through or bounced. Extracted from `requireMember` so
 * gate SELECTION is unit-testable without mocking next/navigation's
 * redirect()/cookies() — the impure wrapper below only needs to act on the
 * result.
 */
export function decideMemberGate(
  accessGate: AccessGate,
  session: Pick<SessionData, "msrUid" | "isRmrMember">,
): "allow" | "redirect" {
  if (accessGate !== "required") return "allow";
  return session.msrUid && session.isRmrMember ? "allow" : "redirect";
}

/**
 * League-aware page gate (Task 5): identical rule to the original
 * `requireRmrMember`, parameterized on an arbitrary league's `accessGate`
 * instead of always reading the deployment's default league via
 * `getLeagueConfig()` — so `/l/[league]` routes gate on THAT league's
 * config, not the default league's.
 *
 * `homeHref` is where a failed gate redirects to (default "/", matching
 * `requireRmrMember`'s legacy behavior exactly); league-scoped routes pass
 * `/l/[slug]` so a bounced viewer lands on that league's own home (which
 * itself renders the Landing view for a required gate) rather than the
 * default league's.
 *
 * Note: `session.isRmrMember` is computed at MSR OAuth login time against
 * only the DEFAULT league's `msrOrgId` (see api/auth/msr/callback/route.ts)
 * — per-league membership (the unused `LeagueMembership` table) isn't wired
 * into login yet, so a non-default league with accessGate "required" would
 * gate on default-league membership. This can't actually reach here: a
 * League row in that state is refused up front by `league-config.ts`'s
 * `toLeagueConfig` (and `league:create --gate required` is refused too), so
 * every `league` passed to `requireMember` is already guaranteed "optional"
 * or "none" unless it's the default league. Wiring login to per-league org
 * membership is PR 3 territory (roles UI).
 */
export async function requireMember(
  league: { accessGate: AccessGate },
  returnPath?: string,
  homeHref: string = "/",
): Promise<{ session: IronSession<SessionData> | null }> {
  // Public leagues (accessGate optional|none) never gate results pages.
  if (league.accessGate !== "required") {
    if (!process.env.SESSION_SECRET) {
      // No sessions configured at all (login disabled) — nothing to gate with.
      return { session: null };
    }
    return { session: await getSession() };
  }

  const session = await getSession();

  if (decideMemberGate(league.accessGate, session) === "redirect") {
    const safe = returnPath ? sanitizeReturnTo(returnPath) : null;
    redirect(safe ? `${homeHref}?returnTo=${encodeURIComponent(safe)}` : homeHref);
  }

  return { session };
}

export async function requireRmrMember(
  returnPath?: string
): Promise<{ session: IronSession<SessionData> | null }> {
  const league = await getLeagueConfig();
  return requireMember(league, returnPath);
}
