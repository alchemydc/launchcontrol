import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guardSuperUser: vi.fn(),
  createLeague: vi.fn(),
  setLeagueMembership: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/admin-guard", () => ({
  guardSuperUser: mocks.guardSuperUser,
}));
vi.mock("@/lib/create-league", () => ({
  createLeague: mocks.createLeague,
}));
vi.mock("@/lib/membership", () => ({
  setLeagueMembership: mocks.setLeagueMembership,
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { POST } from "@/app/api/admin/leagues/route";

// PR #99 security review, item 1: league creation is tenant creation. It must
// be gated on guardSuperUser — a league-scoped admin who could create leagues
// would auto-grant themselves ADMIN of the new tenant. This suite pins that
// the route consults the superuser guard (not guardAnyLeagueAdmin) and fails
// closed on its Response.
describe("POST /api/admin/leagues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the guard's fail-closed response without touching createLeague", async () => {
    mocks.guardSuperUser.mockResolvedValue(
      Response.json({ error: "not found" }, { status: 404 }),
    );
    const response = await POST(
      new Request("http://localhost/api/admin/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "sneaky", name: "Sneaky League" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.guardSuperUser).toHaveBeenCalledTimes(1);
    expect(mocks.createLeague).not.toHaveBeenCalled();
    expect(mocks.setLeagueMembership).not.toHaveBeenCalled();
  });

  it("creates the league for a superuser actor", async () => {
    mocks.guardSuperUser.mockResolvedValue({ actor: { msrUid: "SUPER-1", name: "Super U." } });
    mocks.createLeague.mockResolvedValue({
      league: { slug: "new-league", name: "New League" },
      scoringSystemName: "New League Default",
    });
    const response = await POST(
      new Request("http://localhost/api/admin/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "new-league", name: "New League" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createLeague).toHaveBeenCalledTimes(1);
  });
});
