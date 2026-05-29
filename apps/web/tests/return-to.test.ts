/**
 * return-to.test.ts
 *
 * Unit tests for sanitizeReturnTo in lib/session.ts.
 * Covers every open-redirect probe from the plan's verification section
 * plus happy-path cases.
 */

import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "@/lib/session";

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
});
