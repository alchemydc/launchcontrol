/**
 * MSR OAuth signing helpers and typed fetch wrapper.
 *
 * Critical invariant: OAuth protocol params (oauth_callback, oauth_verifier)
 * MUST flow through oauth.authorize's `data` field so they land in the
 * signature base string AND the Authorization header via toHeader().
 * Do NOT append them post-hoc to the header string or the URL query.
 * See apps/web/scripts/msr-oauth-probe.ts (signedPost) for the reference pattern.
 */

import crypto from "node:crypto";
import OAuth from "oauth-1.0a";

// ---------------------------------------------------------------------------
// MSR /rest/me.json response shape (confirmed via live probe 2026-05-27)
// Double-wrapped: { response: { profile: { … } } }
// ---------------------------------------------------------------------------

export interface MsrOrganization {
  id: string;       // org UUID, uppercase hex with dashes
  memberId: string; // this user's membership ID within the org
  name: string;     // display name, e.g. "PCA - Rocky Mountain Region"
}

export interface MsrProfile {
  id: string;          // MSR UID, UUID uppercase hex with dashes
  firstName: string;
  lastName: string;    // full last name — apply redactLastName() before persisting; never store
  email: string;
  avatar: string;      // empty string observed; typed as string (not optional)
  organizations: MsrOrganization[];
}

export interface MsrMeResponse {
  response: {
    profile: MsrProfile;
  };
}

// ---------------------------------------------------------------------------
// OAuth client (lazy singleton — constructed once per module load)
// ---------------------------------------------------------------------------

function buildOAuthClient(): OAuth {
  const key = process.env.MSR_CONSUMER_KEY;
  const secret = process.env.MSR_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error(
      "MSR_CONSUMER_KEY and MSR_CONSUMER_SECRET must be set in the environment"
    );
  }
  return new OAuth({
    consumer: { key, secret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, signingKey) {
      return crypto
        .createHmac("sha1", signingKey)
        .update(base_string)
        .digest("base64");
    },
  });
}

let _oauth: OAuth | undefined;
function getOAuth(): OAuth {
  if (!_oauth) _oauth = buildOAuthClient();
  return _oauth;
}

// ---------------------------------------------------------------------------
// signRequest
// ---------------------------------------------------------------------------

export interface SignRequestParams {
  url: string;
  method: string;
  /** OAuth token (key+secret). Omit for step 1 (no token yet). */
  token?: OAuth.Token;
  /**
   * Extra data merged into the OAuth request object so it lands in both the
   * signature base string and the Authorization header. Use this for
   * oauth_callback (step 1) and oauth_verifier (step 3).
   */
  data?: Record<string, string>;
}

/**
 * Sign an MSR request and return the Authorization header value.
 * The returned header string is ready to pass as `Authorization: <value>`.
 */
export function signRequest(params: SignRequestParams): OAuth.Header {
  const oauth = getOAuth();
  const requestData: OAuth.RequestOptions = {
    url: params.url,
    method: params.method,
    data: params.data ?? {},
  };
  return oauth.toHeader(oauth.authorize(requestData, params.token));
}

// ---------------------------------------------------------------------------
// parseFormEncoded
// ---------------------------------------------------------------------------

/**
 * Parse an application/x-www-form-urlencoded response body into a plain
 * Record. Values are percent-decoded by URLSearchParams.
 */
export function parseFormEncoded(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

// ---------------------------------------------------------------------------
// signedMsrFetch
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated GET against an MSR endpoint using an access token.
 * Returns parsed JSON typed as T (defaults to MsrMeResponse).
 *
 * The URL must include the `.json` extension (MSR ignores Accept headers).
 */
export async function signedMsrFetch<T = MsrMeResponse>(
  url: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<T> {
  const token: OAuth.Token = { key: accessToken, secret: accessTokenSecret };
  const authHeader = signRequest({ url, method: "GET", token });

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...authHeader,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`MSR fetch ${url} failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}
