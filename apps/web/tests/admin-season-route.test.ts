import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guardLeagueAdmin: vi.fn(),
  updateSeason: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/admin-guard", () => ({
  guardLeagueAdmin: mocks.guardLeagueAdmin,
}));
vi.mock("@/lib/create-season", () => ({
  updateSeason: mocks.updateSeason,
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { PATCH } from "@/app/api/admin/leagues/[slug]/seasons/[seasonSlug]/route";

describe("season PATCH route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guardLeagueAdmin.mockResolvedValue({
      actor: { msrUid: "admin-1", name: "Admin" },
    });
  });

  it.each(["paxTable", "scoringPolicy"])(
    "rejects the removed %s season field and directs callers to the ruleset",
    async (removedField) => {
      const response = await PATCH(
        new Request("http://localhost/api/admin/leagues/example/seasons/2026", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [removedField]: "{}" }),
        }),
        { params: Promise.resolve({ slug: "example", seasonSlug: "2026" }) },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Season scoring fields can no longer be updated directly; edit the season's ruleset instead",
      });
      expect(mocks.updateSeason).not.toHaveBeenCalled();
      expect(mocks.writeAudit).not.toHaveBeenCalled();
    },
  );
});
