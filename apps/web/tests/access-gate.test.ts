import { afterEach, describe, expect, it, vi } from "vitest";
import { getClubConfig } from "@/lib/club-config";
import { gateResultsPage } from "@/lib/session";

// gateResultsPage must never touch the request scope on public deployments —
// that is what keeps results pages ISR-cacheable. cookies() throwing here
// proves the branch is cookie-free; the gated branch swaps in a fake session.
const cookiesMock = vi.fn(() => {
  throw new Error("cookies() must not be called on public deployments");
});
vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

let fakeSession: Record<string, unknown> = {};
vi.mock("iron-session", () => ({
  getIronSession: async () => fakeSession,
}));

afterEach(() => {
  delete process.env.ACCESS_GATE;
  delete process.env.MSR_CONSUMER_KEY;
  delete process.env.SESSION_SECRET;
  cookiesMock.mockClear();
  redirectMock.mockClear();
  fakeSession = {};
});

// requireRmrMember depends on next/headers (request scope), so the unit here
// verifies the gate decision logic exposed via config; the short-circuit branch
// in requireRmrMember is a 3-line guard reviewed by inspection + exercised by build.
describe("access gate config", () => {
  it("defaults to required", () => {
    expect(getClubConfig().accessGate).toBe("required");
  });
  it("optional and none are public modes", () => {
    for (const mode of ["optional", "none"] as const) {
      process.env.ACCESS_GATE = mode;
      expect(getClubConfig().accessGate).toBe(mode);
    }
  });
});

describe("gateResultsPage", () => {
  it("never touches cookies when the gate is optional or none", async () => {
    for (const mode of ["optional", "none"] as const) {
      process.env.ACCESS_GATE = mode;
      await expect(gateResultsPage("/leaderboard")).resolves.toBeUndefined();
    }
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated viewers when the gate is required", async () => {
    process.env.ACCESS_GATE = "required";
    process.env.SESSION_SECRET = "x".repeat(32);
    cookiesMock.mockReturnValueOnce(undefined as never); // required branch may read cookies
    fakeSession = {};
    await expect(gateResultsPage("/leaderboard")).rejects.toThrow(
      "NEXT_REDIRECT:/?returnTo=%2Fleaderboard",
    );
  });

  it("lets members through when the gate is required", async () => {
    process.env.ACCESS_GATE = "required";
    process.env.SESSION_SECRET = "x".repeat(32);
    cookiesMock.mockReturnValueOnce(undefined as never);
    fakeSession = { msrUid: "ABC-123", isRmrMember: true };
    await expect(gateResultsPage("/leaderboard")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
