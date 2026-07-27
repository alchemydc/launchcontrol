import { describe, expect, it } from "vitest";
import { isTrustedAdminRequest } from "@/lib/same-origin";

// PR #99 security review, item 2: centralized same-origin validation for
// unsafe /api/admin/* requests (enforced by src/middleware.ts). SameSite=Lax on
// the session cookie blocks classic cross-SITE CSRF but not a sibling
// subdomain (same-site, different-origin) form-POSTing with the victim's
// ambient cookie — these tests pin the policy the proxy applies.

const ORIGIN = "https://launchcontrol.club";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

describe("isTrustedAdminRequest", () => {
  it("always allows safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isTrustedAdminRequest(method, headers({ "sec-fetch-site": "cross-site" }), ORIGIN)).toBe(
        true,
      );
    }
  });

  it("allows unsafe requests marked same-origin by the browser", () => {
    expect(isTrustedAdminRequest("POST", headers({ "sec-fetch-site": "same-origin" }), ORIGIN)).toBe(
      true,
    );
  });

  it('allows "none" (user-initiated navigation, not attacker-controllable)', () => {
    expect(isTrustedAdminRequest("POST", headers({ "sec-fetch-site": "none" }), ORIGIN)).toBe(true);
  });

  it("rejects sibling-origin (same-site) requests — the Lax gap", () => {
    expect(isTrustedAdminRequest("POST", headers({ "sec-fetch-site": "same-site" }), ORIGIN)).toBe(
      false,
    );
    expect(isTrustedAdminRequest("DELETE", headers({ "sec-fetch-site": "same-site" }), ORIGIN)).toBe(
      false,
    );
  });

  it("rejects cross-site requests", () => {
    expect(isTrustedAdminRequest("POST", headers({ "sec-fetch-site": "cross-site" }), ORIGIN)).toBe(
      false,
    );
  });

  it("Sec-Fetch-Site wins over a matching Origin header", () => {
    // A same-site attacker controls neither header, so a forged-looking
    // combination must still fail closed on the fetch-metadata signal.
    expect(
      isTrustedAdminRequest(
        "POST",
        headers({ "sec-fetch-site": "same-site", origin: ORIGIN }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("falls back to Origin comparison when Sec-Fetch-Site is absent", () => {
    expect(isTrustedAdminRequest("POST", headers({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(
      isTrustedAdminRequest("POST", headers({ origin: "https://staging.launchcontrol.club" }), ORIGIN),
    ).toBe(false);
    expect(isTrustedAdminRequest("PUT", headers({ origin: "null" }), ORIGIN)).toBe(false);
    expect(isTrustedAdminRequest("PUT", headers({ origin: "not a url" }), ORIGIN)).toBe(false);
  });

  it("allows header-less requests (non-browser clients have no ambient-cookie CSRF vector)", () => {
    expect(isTrustedAdminRequest("POST", headers({}), ORIGIN)).toBe(true);
  });
});
