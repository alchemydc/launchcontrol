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
 *  7. Compute isRmrMember from org list.
 *  8. Persist the SessionData fields in the main session cookie.
 *  9. 302 / (events home).
 *
 * On error, redirects to /login?error=<reason>. Full last name is never
 * logged, stored in a cookie, or written to any persistent layer.
 */

import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { MSR_ACCESS_TOKEN_URL, MSR_ME_URL } from "@/lib/msr-endpoints";
import { parseFormEncoded, signRequest, signedMsrFetch } from "@/lib/msr";
import type { MsrMeResponse } from "@/lib/msr";
import { getRequestTokenSession, getSession } from "@/lib/session";
import { redactLastName } from "@/lib/pii";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rmrOrgId = process.env.MSR_RMR_ORG_ID;
  if (!rmrOrgId) {
    throw new Error("MSR_RMR_ORG_ID environment variable is not set");
  }

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

  // 7. Determine RMR membership.
  const isRmrMember = profile.organizations.some((o) => o.id === rmrOrgId);

  // 8. Persist session — only the seven approved fields; full lastName is never stored.
  const session = await getSession();
  session.msrUid = profile.id;
  session.firstName = profile.firstName;
  session.lastInitial = lastInitial;
  session.accessToken = accessToken;
  session.accessTokenSecret = accessSecret;
  session.isRmrMember = isRmrMember;
  await session.save();

  // 9. Send to events home.
  redirect("/");
}
