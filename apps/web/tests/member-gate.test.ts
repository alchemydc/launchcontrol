import { describe, expect, it } from "vitest";
import { decideMemberGate } from "@/lib/session";

// Task 5: requireMember's gate-selection rule, extracted into a pure fn so
// it's unit-testable without mocking next/navigation's redirect()/cookies().
// requireRmrMember (legacy routes) and requireMember (league-scoped routes)
// both funnel through this same decision.

describe("decideMemberGate", () => {
  it("allows through for accessGate 'optional' regardless of session state", () => {
    expect(decideMemberGate("optional", {})).toBe("allow");
    expect(decideMemberGate("optional", { msrUid: "u1", isRmrMember: false })).toBe("allow");
  });

  it("allows through for accessGate 'none' regardless of session state", () => {
    expect(decideMemberGate("none", {})).toBe("allow");
  });

  it("redirects for accessGate 'required' with no session at all", () => {
    expect(decideMemberGate("required", {})).toBe("redirect");
  });

  it("redirects for accessGate 'required' when signed in but not a member", () => {
    expect(decideMemberGate("required", { msrUid: "u1", isRmrMember: false })).toBe("redirect");
  });

  it("redirects for accessGate 'required' when isRmrMember is set but msrUid is missing", () => {
    // Defensive — should never happen (msrUid is always set alongside
    // isRmrMember by the OAuth callback), but the gate shouldn't trust a
    // membership flag with no identity behind it.
    expect(decideMemberGate("required", { isRmrMember: true })).toBe("redirect");
  });

  it("allows through for accessGate 'required' when signed in and a member", () => {
    expect(decideMemberGate("required", { msrUid: "u1", isRmrMember: true })).toBe("allow");
  });
});
