/**
 * GET /api/auth/msr/callback
 *
 * Step 3 of MSR OAuth 1.0a three-legged flow:
 *  1. Read oauth_token + oauth_verifier from query params.
 *  2. Read oauth_token_secret from transient cookie; destroy it immediately.
 *  3. POST to MSR /rest/tokens/access signed with consumer + request token + verifier.
 *  4. Parse response → access token, access secret.
 *  5. GET /rest/me.json with access token.
 *  6. Apply PII rule: compute lastInitial via redactLastName; discard full lastName.
 *  7. Compute isRmrMember from org list (display only — when the default
 *     league has org config at all).
 *  8. Persist the SessionData fields in the main session cookie.
 *  9. 302 to the re-validated returnTo, else "/" (the league card grid).
 *
 * This callback is deliberately league-AGNOSTIC (PR #99 review): it neither
 * requires the default league's MSR org config nor gates returnTo on org
 * membership. Authorization lives with the per-league page gates
 * (checkLeagueAccess/decideLeagueAccess), which every destination re-checks
 * server-side on render — a user without access to the destination league
 * gets that league's normal denial flow, so gating the redirect here would
 * only duplicate logic and (as it did) strand non-default-league members
 * at "/".
 *
 * On error, redirects to /login?error=<reason>. Full last name is never
 * logged, stored in a cookie, or written to any persistent layer.
 */

import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { MSR_ACCESS_TOKEN_URL, MSR_ME_URL } from "@/lib/msr-endpoints";
import { parseFormEncoded, signRequest, signedMsrFetch } from "@/lib/msr";
import type { MsrMeResponse } from "@/lib/msr";
import { getRequestTokenSession, getSession, sanitizeReturnTo } from "@/lib/session";
import { getLeagueConfig } from "@/lib/league-config";
import { redactLastName } from "@/lib/pii";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // No org-config precondition: a required league gated purely by explicit
  // LeagueMembership rows (msrOrgId null) is a supported configuration, and
  // throwing here would 500 every login on such a deployment.
  const league = await getLeagueConfig();
  const orgId = league.msrOrgId;

  const { searchParams } = request.nextUrl;
  const oauthToken = searchParams.get("oauth_token");
  const oauthVerifier = searchParams.get("oauth_verifier");

  // 1. Missing verifier means the user denied authorization.
  if (!oauthVerifier || !oauthToken) {
    redirect("/login?error=denied");
  }

  // 2. Read and immediately destroy the transient request-token cookie.
  const reqSession = await getRequestTokenSession();
  const oauthTokenSecret = reqSession.oauthTokenSecret;
  const rawReturnTo = reqSession.returnTo;
  reqSession.destroy();

  if (!oauthTokenSecret) {
    // Cookie missing or expired — treat as denied.
    redirect("/login?error=denied");
  }

  // 3. Exchange request token for access token.
  //    oauth_verifier flows through the data field so it lands in the
  //    signature base string (same pattern as the probe's signedPost).
  const authHeader = signRequest({
    url: MSR_ACCESS_TOKEN_URL,
    method: "POST",
    token: { key: oauthToken, secret: oauthTokenSecret },
    data: { oauth_verifier: oauthVerifier },
  });

  const tokenRes = await fetch(MSR_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  if (!tokenRes.ok) {
    redirect("/login?error=token-exchange");
  }

  // 4. Parse access token response.
  const tokenBody = await tokenRes.text();
  const tokenData = parseFormEncoded(tokenBody);
  const accessToken = tokenData["oauth_token"];
  const accessSecret = tokenData["oauth_token_secret"];

  if (!accessToken || !accessSecret) {
    redirect("/login?error=token-exchange");
  }

  // 5. Fetch /rest/me.json with the access token.
  let me: MsrMeResponse;
  try {
    me = await signedMsrFetch(MSR_ME_URL, accessToken, accessSecret);
  } catch {
    redirect("/login?error=profile-fetch");
  }

  const profile = me.response.profile;

  // 6. PII rule: compute lastInitial from lastName; discard full lastName immediately.
  //    redactLastName is imported from lib/pii (not redefined here).
  const lastInitial = redactLastName(profile.lastName);

  // 7. Default-league org membership — a display flag (/me badge), not an
  //    authorization input; per-league gates use session.msrOrgIds instead.
  const isRmrMember = orgId != null && profile.organizations.some((o) => o.id === orgId);

  // 8. Persist session — only the seven approved fields; full lastName is never stored.
  const session = await getSession();
  session.msrUid = profile.id;
  session.firstName = profile.firstName;
  session.lastInitial = lastInitial;
  session.accessToken = accessToken;
  session.accessTokenSecret = accessSecret;
  session.isRmrMember = isRmrMember;
  session.msrOrgIds = profile.organizations.map((o) => o.id);
  await session.save();

  // 9. Redirect to the re-validated (same-origin, path-only) returnTo, else
  //    "/". Not gated on org membership: the destination page enforces its
  //    own league's access rules server-side, and gating here stranded
  //    legitimate non-default-league members (and superusers) at "/".
  const returnTo = sanitizeReturnTo(rawReturnTo);
  redirect(returnTo || "/");
}
