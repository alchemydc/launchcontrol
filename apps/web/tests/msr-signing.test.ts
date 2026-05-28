/**
 * msr-signing.test.ts
 *
 * Unit tests for the OAuth signing helpers in lib/msr.ts.
 *
 * No live OAuth integration test — manual smoke against MSR is the
 * verification path (see docs/BUILD.md M2 verification section).
 * These tests run in CI without any network access or MSR credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseFormEncoded, signRequest } from "@/lib/msr";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  // Provide deterministic consumer credentials for signing tests.
  process.env.MSR_CONSUMER_KEY = "test-consumer-key";
  process.env.MSR_CONSUMER_SECRET = "test-consumer-secret";
});

afterAll(() => {
  // Restore original environment.
  Object.assign(process.env, ORIGINAL_ENV);
});

// ---------------------------------------------------------------------------
// signRequest — deterministic HMAC-SHA1 signature pinning
//
// To derive the expected signature for a new fixture:
//   1. Hard-code timestamp + nonce in a scratch script using oauth-1.0a.
//   2. Call oauth.authorize({ url, method, data: { oauth_timestamp, oauth_nonce, ... } }, token).
//   3. Print oauth_signature from the result.
//
// oauth-1.0a picks up oauth_timestamp / oauth_nonce from the data field when
// they are present, which is how we inject them for deterministic tests.
// ---------------------------------------------------------------------------

describe("signRequest — HMAC-SHA1 signature pinning", () => {
  it("produces the expected Authorization header for a POST with no token", () => {
    // Fixed inputs for determinism.
    const url = "https://api.motorsportreg.com/rest/tokens/request";
    const authHeader = signRequest({
      url,
      method: "POST",
      // Inject fixed timestamp and nonce through the data field so the signing
      // library uses them instead of generating random values.
      data: {
        oauth_callback: "http://localhost:3000/api/auth/msr/callback",
        oauth_timestamp: "1748300000",
        oauth_nonce: "abc123fixed",
      },
    });

    expect(authHeader).toHaveProperty("Authorization");
    const auth = authHeader.Authorization;
    expect(auth).toMatch(/^OAuth /);
    expect(auth).toContain('oauth_consumer_key="test-consumer-key"');
    expect(auth).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(auth).toContain('oauth_callback="http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fmsr%2Fcallback"');
    // Snapshot the full signature so regressions in signing math are caught.
    expect(auth).toMatchSnapshot();
  });

  it("produces the expected Authorization header for a POST with a token (access exchange)", () => {
    const url = "https://api.motorsportreg.com/rest/tokens/access";
    const authHeader = signRequest({
      url,
      method: "POST",
      token: { key: "req-token-key", secret: "req-token-secret" },
      data: {
        oauth_verifier: "verifier-xyz",
        oauth_timestamp: "1748300100",
        oauth_nonce: "nonce456fixed",
      },
    });

    const auth = authHeader.Authorization;
    expect(auth).toMatch(/^OAuth /);
    expect(auth).toContain('oauth_token="req-token-key"');
    expect(auth).toContain('oauth_verifier="verifier-xyz"');
    expect(auth).toMatchSnapshot();
  });

  it("produces a different signature when the token secret changes", () => {
    const url = "https://api.motorsportreg.com/rest/me.json";
    const shared = {
      url,
      method: "GET",
      data: { oauth_timestamp: "1748300200", oauth_nonce: "nonceGET" },
    };

    const headerA = signRequest({
      ...shared,
      token: { key: "tok", secret: "secret-a" },
    });
    const headerB = signRequest({
      ...shared,
      token: { key: "tok", secret: "secret-b" },
    });

    expect(headerA.Authorization).not.toEqual(headerB.Authorization);
  });
});

// ---------------------------------------------------------------------------
// parseFormEncoded
// ---------------------------------------------------------------------------

describe("parseFormEncoded", () => {
  it("parses a basic token response", () => {
    const body =
      "oauth_token=abc123&oauth_token_secret=xyz789&oauth_callback_confirmed=true";
    const result = parseFormEncoded(body);
    expect(result).toEqual({
      oauth_token: "abc123",
      oauth_token_secret: "xyz789",
      oauth_callback_confirmed: "true",
    });
  });

  it("decodes percent-encoded values", () => {
    const body = "oauth_callback=http%3A%2F%2Flocalhost%3A3000%2Fcallback";
    const result = parseFormEncoded(body);
    expect(result).toEqual({
      oauth_callback: "http://localhost:3000/callback",
    });
  });

  it("returns an empty object for an empty string", () => {
    expect(parseFormEncoded("")).toEqual({});
  });
});
