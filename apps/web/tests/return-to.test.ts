/**
 * return-to.test.ts
 *
 * Unit tests for sanitizeReturnTo in lib/session.ts.
 * Covers every open-redirect probe from the plan's verification section
 * plus happy-path cases.
 */

import { describe, it, expect } from "vitest";
import { landingReturnTo, sanitizeReturnTo } from "@/lib/session";

describe("sanitizeReturnTo — happy paths", () => {
  it('accepts "/"', () => {
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  it('accepts "/leaderboard"', () => {
    expect(sanitizeReturnTo("/leaderboard")).toBe("/leaderboard");
  });

  it('accepts "/events/foo?bar=1"', () => {
    expect(sanitizeReturnTo("/events/foo?bar=1")).toBe("/events/foo?bar=1");
  });

  it("accepts a path with multiple segments", () => {
    expect(sanitizeReturnTo("/leaderboard/2025")).toBe("/leaderboard/2025");
  });

  it("strips the fragment", () => {
    expect(sanitizeReturnTo("/leaderboard#section")).toBe("/leaderboard");
  });
});

describe("sanitizeReturnTo — open-redirect probes", () => {
  it('rejects "//evil.com"', () => {
    expect(sanitizeReturnTo("//evil.com")).toBeNull();
  });

  it('rejects "/\\evil.com"', () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBeNull();
  });

  it('rejects "https://evil.com"', () => {
    expect(sanitizeReturnTo("https://evil.com")).toBeNull();
  });

  it('rejects "javascript:alert(1)"', () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it('rejects "/path%0d%0aSet-Cookie:x" (CRLF injection)', () => {
    // %0d = CR, %0a = LF — URL-decoded by the URL constructor, then rejected as control chars.
    expect(sanitizeReturnTo("/path%0d%0aSet-Cookie:x")).toBeNull();
  });

  it("rejects an absolute URL with path", () => {
    expect(sanitizeReturnTo("https://evil.com/path")).toBeNull();
  });

  it("rejects a path with a backslash", () => {
    expect(sanitizeReturnTo("/path\\evil")).toBeNull();
  });
});

describe("sanitizeReturnTo — edge cases", () => {
  it("rejects null", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(sanitizeReturnTo(undefined)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(sanitizeReturnTo("")).toBeNull();
  });

  it("rejects a string longer than 512 chars", () => {
    expect(sanitizeReturnTo("/" + "a".repeat(512))).toBeNull();
  });

  it("rejects a string with a tab character", () => {
    expect(sanitizeReturnTo("/path\twith-tab")).toBeNull();
  });

  it("rejects a string with a newline", () => {
    expect(sanitizeReturnTo("/path\nnewline")).toBeNull();
  });

  it("rejects array input (repeated query keys)", () => {
    expect(sanitizeReturnTo(["/leaderboard", "/drivers/1"])).toBeNull();
  });
});

describe("landingReturnTo — league-home sign-in fallback", () => {
  it("returns the league's own path when no season is given", () => {
    expect(landingReturnTo("/l/pca-rmr")).toBe("/l/pca-rmr");
  });

  it("preserves ?season=", () => {
    expect(landingReturnTo("/l/pca-rmr", "2026")).toBe("/l/pca-rmr?season=2026");
  });

  it("ignores an array season (repeated query key)", () => {
    expect(landingReturnTo("/l/pca-rmr", ["2026", "2025"])).toBe("/l/pca-rmr");
  });

  it("ignores an empty-string season", () => {
    expect(landingReturnTo("/l/pca-rmr", "")).toBe("/l/pca-rmr");
  });

  it("encodes a season slug with reserved characters", () => {
    expect(landingReturnTo("/l/pca-rmr", "a&b")).toBe("/l/pca-rmr?season=a%26b");
  });

  it("still defers to sanitizeReturnTo for an unsafe basePath", () => {
    expect(landingReturnTo("//evil.com")).toBeNull();
  });
});
