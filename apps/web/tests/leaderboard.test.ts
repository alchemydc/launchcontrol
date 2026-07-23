import { describe, it, expect } from "vitest";
import { buildLeaderboard } from "@/lib/leaderboard";
import { CONE_PENALTY_MS } from "@/lib/constants";

// Pure-function unit tests — no Prisma, no DB. buildLeaderboard's entry shape
// isn't exported, so these fixtures are structurally shaped to match it
// (driver/class/paxClass/runs), same as the real Prisma include.

function entry(overrides: {
  driverId: number;
  driverName: [string, string];
  carNumber: string;
  classCode: string;
  paxIndex: number;
  runs: Array<{ runNumber: number; rawTimeMs: number | null; cones: number; disposition: string }>;
}) {
  const [firstName, lastInitial] = overrides.driverName;
  return {
    id: overrides.driverId,
    carNumber: overrides.carNumber,
    carDescription: null,
    bestCommittedRunNumber: null,
    driver: { id: overrides.driverId, firstName, lastInitial },
    class: { code: overrides.classCode },
    paxClass: { code: overrides.classCode, paxIndex: { toString: () => String(overrides.paxIndex) } },
    runs: overrides.runs as never,
  };
}

describe("buildLeaderboard() — penaltyMs (League Foundation PR 2 Task 7)", () => {
  // Two drivers, same class, whose relative order flips depending on the
  // per-cone penalty: Fast has 2 cones, Slow has none. At the default 2000ms
  // penalty Slow wins; at a 500ms penalty Fast wins — proving the penalty
  // value actually drives both the per-run correctedMs and the ranking.
  const entries = [
    entry({
      driverId: 1,
      driverName: ["Fast", "F."],
      carNumber: "1",
      classCode: "AS",
      paxIndex: 1.0,
      runs: [{ runNumber: 1, rawTimeMs: 50000, cones: 2, disposition: "CLEAN" }],
    }),
    entry({
      driverId: 2,
      driverName: ["Slow", "S."],
      carNumber: "2",
      classCode: "AS",
      paxIndex: 1.0,
      runs: [{ runNumber: 1, rawTimeMs: 53000, cones: 0, disposition: "CLEAN" }],
    }),
  ];

  it("defaults to CONE_PENALTY_MS — Slow's clean 53.000 beats Fast's 50.000+2 cones", () => {
    const rows = buildLeaderboard(entries as never);
    expect(rows.map((r) => r.driverName)).toEqual(["Slow S.", "Fast F."]);
    expect(rows[0]!.bestRawMs).toBe(53000);
    expect(rows[1]!.bestRawMs).toBe(50000 + 2 * CONE_PENALTY_MS);
  });

  it("an explicit penaltyMs equal to the constant matches the default (parity)", () => {
    expect(buildLeaderboard(entries as never, CONE_PENALTY_MS)).toEqual(buildLeaderboard(entries as never));
  });

  it("a 500ms-penalty season flips the ranking — Fast's corrected time now wins", () => {
    const rows = buildLeaderboard(entries as never, 500);
    expect(rows.map((r) => r.driverName)).toEqual(["Fast F.", "Slow S."]);
    expect(rows[0]!.bestRawMs).toBe(50000 + 2 * 500);
    expect(rows[0]!.runs[0]!.correctedMs).toBe(51000);
  });
});
