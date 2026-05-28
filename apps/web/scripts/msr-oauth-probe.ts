/**
 * msr-oauth-probe.ts
 *
 * One-shot three-legged OAuth 1.0a probe against MotorsportReg.
 * Writes the raw /rest/me JSON to docs/private/rest_me_sample.json.
 * NOT wired into CI or package.json scripts.
 *
 * Run: pnpm --filter web tsx --env-file=.env scripts/msr-oauth-probe.ts
 *
 * Prerequisites: MSR_CONSUMER_KEY and MSR_CONSUMER_SECRET in .env.
 * No live integration test in CI — OAuth requires interactive browser sign-in.
 */

import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import OAuth from "oauth-1.0a";

// ---------------------------------------------------------------------------
// Config / validation
// ---------------------------------------------------------------------------

const CONSUMER_KEY = process.env.MSR_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MSR_CONSUMER_SECRET;
const CALLBACK_URL =
  process.env.MSR_OAUTH_CALLBACK_URL ??
  "http://localhost:3000/api/auth/msr/callback";

if (!CONSUMER_KEY || !CONSUMER_SECRET) {
  console.error(
    "ERROR: MSR_CONSUMER_KEY and MSR_CONSUMER_SECRET must be set in .env"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// OAuth client
// ---------------------------------------------------------------------------

const oauth = new OAuth({
  consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFormEncoded(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

async function signedPost(
  url: string,
  token: OAuth.Token | null,
  data: Record<string, string> = {}
): Promise<string> {
  // Pass `data` through oauth.authorize so it lands in the signature base
  // string. Any oauth_-prefixed keys then also flow into the Authorization
  // header via toHeader (per oauth-1.0a behavior). This is the correct way
  // to send oauth_callback / oauth_verifier — passing them only in the URL
  // or appending them post-hoc to the header leaves the signature wrong.
  const requestData = { url, method: "POST", data };
  const authHeader = oauth.toHeader(
    oauth.authorize(requestData, token ?? undefined)
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`POST ${url} → ${res.status}\n${text}`);
    console.error(
      `(sent Authorization: ${authHeader.Authorization.slice(0, 80)}...)`
    );
    process.exit(1);
  }
  return text;
}

async function signedGet(
  url: string,
  token: OAuth.Token
): Promise<string> {
  const requestData = { url, method: "GET" };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const res = await fetch(url, {
    method: "GET",
    headers: { ...authHeader, Accept: "application/json" },
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`GET ${url} → ${res.status}\n${text}`);
    process.exit(1);
  }
  return text;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  // Step (a): obtain request token
  console.log("\n[1/5] Requesting OAuth request token from MSR...");
  const requestTokenBody = await signedPost(
    "https://api.motorsportreg.com/rest/tokens/request",
    null,
    { oauth_callback: CALLBACK_URL }
  );
  const requestTokens = parseFormEncoded(requestTokenBody);
  const requestToken = requestTokens["oauth_token"];
  const requestTokenSecret = requestTokens["oauth_token_secret"];

  if (!requestToken || !requestTokenSecret) {
    const keys = Object.keys(requestTokens).join(", ");
    console.error(
      `ERROR: Could not parse request token. Got keys: ${keys || "(none)"}`
    );
    process.exit(1);
  }

  // Step (b)/(c): direct operator to authorize
  const authorizeUrl = `https://www.motorsportreg.com/index.cfm/event/oauth?oauth_token=${requestToken}`;
  console.log("\n[2/5] Open this URL in your browser and sign in to MSR:");
  console.log(`\n  ${authorizeUrl}\n`);
  console.log(
    "After approving, the browser will try to redirect to localhost:3000"
  );
  console.log(
    "(that will error — no server running yet). Copy the FULL redirect URL"
  );
  console.log("from the address bar and paste it below.\n");

  const redirectUrl = await prompt("Paste full redirect URL: ");

  // Step (d): parse verifier from pasted URL
  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(redirectUrl);
  } catch {
    console.error("ERROR: Could not parse URL:", redirectUrl);
    process.exit(1);
  }

  if (!parsedUrl) {
    process.exit(1);
  }

  const verifier = parsedUrl.searchParams.get("oauth_verifier");
  const tokenBack = parsedUrl.searchParams.get("oauth_token");

  if (!verifier) {
    console.error("ERROR: No oauth_verifier found in the pasted URL.");
    process.exit(1);
  }
  if (tokenBack && tokenBack !== requestToken) {
    console.warn(
      "WARN: oauth_token in redirect differs from request token"
    );
  }

  // Step (e): exchange for access token
  console.log("\n[3/5] Exchanging for access token...");
  const accessBody = await signedPost(
    "https://api.motorsportreg.com/rest/tokens/access",
    { key: requestToken, secret: requestTokenSecret },
    { oauth_verifier: verifier }
  );
  const accessTokens = parseFormEncoded(accessBody);
  const accessToken = accessTokens["oauth_token"];
  const accessSecret = accessTokens["oauth_token_secret"];

  if (!accessToken || !accessSecret) {
    console.error("ERROR: Could not parse access token. Response was:");
    console.error(accessBody);
    process.exit(1);
  }

  // Step (f): fetch /rest/me
  // MSR returns XML by default; the `.json` URL extension is the documented
  // way to get JSON. The Accept header alone is ignored.
  console.log("\n[4/5] Fetching /rest/me.json...");
  const meJson = await signedGet(
    "https://api.motorsportreg.com/rest/me.json",
    { key: accessToken, secret: accessSecret }
  );

  // Step (g): write raw JSON to docs/private/
  const outPath = path.resolve(
    process.cwd(),
    "../../docs/private/rest_me_sample.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, meJson, "utf8");
  console.log(`\n[5/5] Raw JSON written to: ${outPath}`);

  // Step (h): redacted summary to stdout
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(meJson);
  } catch {
    console.log("(Response is not JSON — raw content saved to file)");
    return;
  }

  console.log("\n--- Redacted summary (no PII) ---");
  console.log("Top-level keys:", Object.keys(parsed).join(", "));

  // MSR returns { response: { profile: { organizations: [...] } } }
  const response = (parsed as { response?: unknown }).response;
  const profile =
    response && typeof response === "object"
      ? (response as { profile?: unknown }).profile
      : undefined;
  const orgs =
    profile && typeof profile === "object"
      ? (profile as { organizations?: unknown }).organizations
      : undefined;

  if (Array.isArray(orgs)) {
    console.log(`organizations[].length: ${orgs.length}`);
    if (orgs.length > 0) {
      console.log(
        "organizations[0] keys:",
        Object.keys(orgs[0] as object).join(", ")
      );
    }
  }

  // Surface the org id field name without printing values
  const possibleIdFields = ["id", "uuid", "organizationId", "orgId"];
  for (const field of possibleIdFields) {
    if (Array.isArray(orgs) && orgs.length > 0 && field in (orgs[0] as object)) {
      console.log(`Org id field name observed: "${field}"`);
    }
  }

  console.log("\nInspect the saved JSON privately to see full field values.");
}

main().catch((err: unknown) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
