/**
 * Same-origin validation for the admin API (PR #99 security review).
 *
 * The session cookie is SameSite=Lax, which blocks classic cross-SITE CSRF —
 * but not same-site-different-origin attacks (a compromised sibling subdomain
 * can form-POST to production with the victim's ambient cookie), and several
 * admin POST routes are bodyless, so "requires JSON" is no defense either
 * (Request.json() never checks Content-Type). This helper centralizes the
 * check for every unsafe /api/admin/* request (enforced by src/middleware.ts):
 *
 * 1. Safe methods (GET/HEAD/OPTIONS) pass — they must not mutate.
 * 2. If the browser sent Sec-Fetch-Site (every modern browser does), require
 *    "same-origin" ("none" also passes: it means a user-initiated navigation
 *    like the address bar, not an attacker-controlled subresource/form).
 * 3. Otherwise, if an Origin header is present, it must match the request's
 *    own origin.
 * 4. Neither header → a non-browser client (curl, server-to-server). Allowed:
 *    CSRF is an ambient-cookie attack, which requires a browser, and browsers
 *    always send at least one of the two headers on unsafe requests.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isTrustedAdminRequest(
  method: string,
  headers: { get(name: string): string | null },
  requestOrigin: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;

  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  const origin = headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return true;
}
