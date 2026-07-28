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
import { redirect } from "next/navigation";
import { getLeagueConfig, type LeagueConfig } from "@/lib/league-config";
import { decideLeagueAccess, type LeagueAccessDecision } from "@/lib/league-access";
import { getMembershipRole } from "@/lib/membership";
import { isSuperUser } from "@/lib/super-user";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// SESSION_SECRET is checked lazily on first use — not at module load — so
// `next build` (which evaluates every route handler module to collect page
// data) does not require the secret to be present in the build environment.
// ---------------------------------------------------------------------------

function hasSessionSecret(): boolean {
  const secret = process.env.SESSION_SECRET;
  return typeof secret === "string" && secret.length >= 32;
}

function getSessionSecret(): string {
  if (!hasSessionSecret()) {
    throw new Error(
      "SESSION_SECRET environment variable must be set and at least 32 characters long"
    );
  }
  return process.env.SESSION_SECRET as string;
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
  /** MSR org IDs from the login profile — enables per-league org gating (PR 3). */
  msrOrgIds?: string[];
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

/**
 * Default sign-in destination for a league home rendering the Landing view:
 * the league's own path, so a direct click from the league grid (which carries
 * no ?returnTo) returns there after MSR login instead of falling back to "/".
 * Preserves ?season= when present. Run through sanitizeReturnTo so the result
 * obeys the same same-origin/path-only invariant as a caller-supplied value.
 */
export function landingReturnTo(
  basePath: string,
  season?: string | string[],
): string | null {
  const s = typeof season === "string" && season ? season : null;
  return sanitizeReturnTo(
    s ? `${basePath}?season=${encodeURIComponent(s)}` : basePath,
  );
}

// ---------------------------------------------------------------------------
// requireMember / requireRmrMember — page-level gate
//
// Callers MUST NOT wrap this in try/catch — redirect() throws NEXT_REDIRECT.
// Gate runs before any data fetch so unauthorized viewers cannot probe slug
// existence via 404 vs redirect behavior.
// ---------------------------------------------------------------------------

/**
 * Resolve one league's access decision for the current session, without
 * redirecting — the value form that `l/[league]/page.tsx` branches on
 * (Landing vs EventsHome) and that `requireMember` turns into a redirect.
 *
 * Decision chain (all handled by the pure `decideLeagueAccess`, spec
 * §Access decision order): superuser > BLOCKED > explicit membership row
 * (ADMIN/MEMBER) > public gate > MSR org match > redirect. Public gates
 * ("optional"/"none") short-circuit to "allow" WITHOUT any session or DB
 * read, so a BLOCKED row only bites on a "required" gate.
 *
 * For a "required" gate this reads the session cookie and, in parallel,
 * looks up superuser status and this viewer's `LeagueMembership` role for
 * THIS league (`league.id`). Org matching uses `session.msrOrgIds`, captured
 * at MSR login (PR 3, Task 5); sessions minted before that field shipped
 * lack it and fall through to "redirect" (re-login) — accepted per spec.
 */
export async function checkLeagueAccess(
  league: LeagueConfig,
): Promise<LeagueAccessDecision> {
  // Public leagues never gate — return before any session/DB read so a
  // BLOCKED membership row can't deny access on a public gate.
  if (league.accessGate !== "required") return "allow";

  // Gated, but no session secret configured (login disabled on this deploy):
  // there is nothing to authenticate with, so never admit.
  if (!hasSessionSecret()) return "redirect";

  const session = await getSession();
  const [superUser, membershipRole] = await Promise.all([
    isSuperUser(session.msrUid),
    session.msrUid
      ? getMembershipRole(prisma, league.id, session.msrUid)
      : Promise.resolve(null),
  ]);

  return decideLeagueAccess({
    accessGate: league.accessGate,
    msrOrgId: league.msrOrgId,
    membershipRole,
    superUser,
    session: { msrUid: session.msrUid, msrOrgIds: session.msrOrgIds },
  });
}

/**
 * League-aware page gate: redirects a viewer who fails `checkLeagueAccess`
 * for `league`, and returns otherwise. Parameterized on an arbitrary
 * league's config so `/l/[league]` routes gate on THAT league (and
 * `requireRmrMember` on the deployment default).
 *
 * `homeHref` is where a failed gate lands; every caller passes `/l/[slug]`
 * so a bounced viewer reaches that league's own home (which renders the
 * Landing sign-in view under a "required" gate) rather than ROOT `/`, which
 * is now always the league gate (card grid) with no sign-in prompt.
 *
 * `checkLeagueAccess` outcomes map to:
 *   - "allow"    → return (let the page render).
 *   - "deny"     → redirect to `homeHref` with NO returnTo — the viewer is
 *                  signed in but explicitly BLOCKED, so a sign-in loop is
 *                  pointless.
 *   - "redirect" → redirect to `homeHref?returnTo=…` so a successful sign-in
 *                  bounces back to the page they wanted.
 *
 * Callers MUST NOT wrap this in try/catch — redirect() throws NEXT_REDIRECT.
 */
export async function requireMember(
  league: LeagueConfig,
  returnPath: string | undefined,
  homeHref: string,
): Promise<void> {
  // Public leagues (accessGate optional|none) never gate results pages.
  if (league.accessGate !== "required") return;

  // Gated, but no session secret configured (login disabled on this deploy):
  // there is nothing to authenticate with, so never admit.
  if (!hasSessionSecret()) redirect(homeHref);

  const decision = await checkLeagueAccess(league);
  if (decision === "allow") return;
  if (decision === "deny") redirect(homeHref);

  const safe = returnPath ? sanitizeReturnTo(returnPath) : null;
  redirect(safe ? `${homeHref}?returnTo=${encodeURIComponent(safe)}` : homeHref);
}

/**
 * Access gate for results routes that may use ISR. Public leagues return
 * before any request-scoped API is read; required leagues delegate to the
 * normal per-league membership gate and therefore remain request-rendered.
 */
export async function gateResultsPage(
  league: LeagueConfig,
  returnPath: string | undefined,
  homeHref: string,
): Promise<void> {
  if (league.accessGate !== "required") return;
  await requireMember(league, returnPath, homeHref);
}

export async function requireRmrMember(returnPath?: string): Promise<void> {
  const league = await getLeagueConfig();
  // ROOT `/` is now always the league gate (no sign-in prompt) — bounce to
  // the default league's own scoped home instead, same pattern every
  // `/l/[league]` route already uses.
  await requireMember(league, returnPath, `/l/${league.slug}`);
}
