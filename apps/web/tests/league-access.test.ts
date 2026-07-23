import { describe, it, expect } from "vitest";
import { decideLeagueAccess } from "@/lib/league-access";

const GATED = { accessGate: "required", msrOrgId: "ORG-1" };
const ANON = { msrUid: undefined, msrOrgIds: undefined };
const ORG_MEMBER = { msrUid: "U", msrOrgIds: ["ORG-1", "ORG-9"] };
const OTHER_ORG = { msrUid: "U", msrOrgIds: ["ORG-9"] };

describe("decideLeagueAccess", () => {
  it("superuser always allowed, even when BLOCKED", () => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: "BLOCKED", superUser: true, session: ANON })).toBe("allow");
  });
  it("BLOCKED denies despite org match", () => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: "BLOCKED", superUser: false, session: ORG_MEMBER })).toBe("deny");
  });
  it.each(["ADMIN", "MEMBER"] as const)("%s row allows without org", (role) => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: role, superUser: false, session: OTHER_ORG })).toBe("allow");
  });
  it.each(["optional", "none"])("gate %s allows anonymous", (accessGate) => {
    expect(decideLeagueAccess({ accessGate, msrOrgId: "ORG-1", membershipRole: null, superUser: false, session: ANON })).toBe("allow");
  });
  it("org match allows on required gate", () => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: null, superUser: false, session: ORG_MEMBER })).toBe("allow");
  });
  it("no org match, no row -> redirect", () => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: null, superUser: false, session: OTHER_ORG })).toBe("redirect");
  });
  it("required gate with null msrOrgId and no row -> redirect (membership-only league)", () => {
    expect(decideLeagueAccess({ accessGate: "required", msrOrgId: null, membershipRole: null, superUser: false, session: ORG_MEMBER })).toBe("redirect");
  });
  it("legacy session without msrOrgIds -> redirect (must re-login)", () => {
    expect(decideLeagueAccess({ ...GATED, membershipRole: null, superUser: false, session: { msrUid: "U" } })).toBe("redirect");
  });
});
