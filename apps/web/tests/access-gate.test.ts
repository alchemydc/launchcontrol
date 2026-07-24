import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeagueConfig } from "@/lib/league-config";
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

vi.mock("iron-session", () => ({
  getIronSession: async () => ({}),
}));

function league(accessGate: LeagueConfig["accessGate"]): LeagueConfig {
  return {
    id: 1,
    slug: "test",
    name: "Test League",
    siteTitle: "Test",
    siteDescription: "Test",
    footerText: null,
    landingDescription: "Test",
    accessGate,
    msrOrgId: null,
    loginEnabled: false,
    smugmugUser: null,
    smugmugDisciplinePath: null,
  };
}

afterEach(() => {
  delete process.env.ACCESS_GATE;
  delete process.env.MSR_CONSUMER_KEY;
  delete process.env.SESSION_SECRET;
  cookiesMock.mockClear();
  redirectMock.mockClear();
});

describe("gateResultsPage", () => {
  it("never touches cookies when the gate is optional or none", async () => {
    for (const mode of ["optional", "none"] as const) {
      await expect(
        gateResultsPage(league(mode), "/leaderboard", "/l/test"),
      ).resolves.toBeUndefined();
    }
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated viewers when the gate is required", async () => {
    await expect(
      gateResultsPage(league("required"), "/leaderboard", "/l/test"),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/l/test",
    );
    expect(cookiesMock).not.toHaveBeenCalled();
  });
});
