/**
 * GET /api/auth/msr/login
 *
 * Step 1 of MSR OAuth 1.0a three-legged flow:
 *  1. POST to MSR /rest/tokens/request signed with consumer creds + oauth_callback.
 *  2. Parse response → { oauth_token, oauth_token_secret }.
 *  3. Stash oauth_token_secret in the short-lived transient cookie (lc_msr_req).
 *  4. 302 to MSR authorize page.
 */

import { redirect } from "next/navigation";
import { MSR_AUTHORIZE_URL_BASE, MSR_REQUEST_TOKEN_URL } from "@/lib/msr-endpoints";
import { parseFormEncoded, signRequest } from "@/lib/msr";
import { getRequestTokenSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const callbackUrl = process.env.MSR_OAUTH_CALLBACK_URL;
  if (!callbackUrl) {
    throw new Error("MSR_OAUTH_CALLBACK_URL environment variable is not set");
  }

  // 1. Sign and POST to /rest/tokens/request — oauth_callback goes through
  //    oauth.authorize's data field so it lands in the signature base string.
  const authHeader = signRequest({
    url: MSR_REQUEST_TOKEN_URL,
    method: "POST",
    data: { oauth_callback: callbackUrl },
  });

  const res = await fetch(MSR_REQUEST_TOKEN_URL, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  if (!res.ok) {
    throw new Error(
      `MSR request token failed: ${res.status} ${res.statusText}`
    );
  }

  // 2. Parse the form-encoded response.
  const body = await res.text();
  const tokens = parseFormEncoded(body);
  const oauthToken = tokens["oauth_token"];
  const oauthTokenSecret = tokens["oauth_token_secret"];

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error(
      `MSR request token response missing expected fields. Got keys: ${Object.keys(tokens).join(", ")}`
    );
  }

  // 3. Stash the token secret in the transient session cookie.
  const reqSession = await getRequestTokenSession();
  reqSession.oauthTokenSecret = oauthTokenSecret;
  await reqSession.save();

  // 4. Redirect to the MSR authorize page.
  redirect(`${MSR_AUTHORIZE_URL_BASE}?oauth_token=${oauthToken}`);
}
