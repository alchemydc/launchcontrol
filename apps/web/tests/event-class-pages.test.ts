import { describe, expect, it } from "vitest";

import {
  classUsesPaxMetric,
  filterRowsForClass,
  summarizeEventClasses,
  type LeaderboardRow,
} from "@/lib/leaderboard";

function row(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    driverId: 1,
    driverName: "Alice A.",
    carNumber: "11",
    classCode: "SS",
    paxClassCode: "SS",
    paxIndex: 0.83,
    carDescription: null,
    bestRawMs: 50_000,
    bestPaxMs: 41_500,
    runs: [],
    ...overrides,
  };
}

describe("classUsesPaxMetric", () => {
  it("is false when PAX standings are disabled", () => {
    const rows = [row({ paxIndex: 0.8 }), row({ driverId: 2, paxIndex: 0.9 })];
    expect(classUsesPaxMetric(rows, false)).toBe(false);
  });

  it("is false for a homogeneous class even with PAX standings on", () => {
    const rows = [row({ paxIndex: 0.83 }), row({ driverId: 2, paxIndex: 0.83 })];
    expect(classUsesPaxMetric(rows, true)).toBe(false);
  });

  it("is true for heterogeneous per-entry factors with PAX standings on", () => {
    const rows = [row({ paxIndex: 0.8 }), row({ driverId: 2, paxIndex: 0.9 })];
    expect(classUsesPaxMetric(rows, true)).toBe(true);
  });
});

describe("summarizeEventClasses", () => {
  it("groups by class alphabetically with entry counts and raw-best winners", () => {
    const rows = [
      row({ driverId: 1, driverName: "Slow S.", classCode: "SS", bestRawMs: 52_000, bestPaxMs: 43_160 }),
      row({ driverId: 2, driverName: "Fast F.", classCode: "SS", bestRawMs: 50_000, bestPaxMs: 41_500 }),
      row({ driverId: 3, driverName: "Solo B.", classCode: "AS", bestRawMs: 55_000, bestPaxMs: 45_650 }),
    ];

    expect(summarizeEventClasses(rows, false)).toEqual([
      {
        classCode: "AS",
        entryCount: 1,
        winner: { driverId: 3, driverName: "Solo B.", bestRawMs: 55_000 },
      },
      {
        classCode: "SS",
        entryCount: 2,
        winner: { driverId: 2, driverName: "Fast F.", bestRawMs: 50_000 },
      },
    ]);
  });

  it("picks the winner by PAX metric for heterogeneous run-group classes", () => {
    // Raw order says driver 1 wins; indexed order says driver 2 wins.
    const rows = [
      row({ driverId: 1, driverName: "Raw R.", classCode: "M", paxIndex: 0.9, bestRawMs: 50_000, bestPaxMs: 45_000 }),
      row({ driverId: 2, driverName: "Pax P.", classCode: "M", paxIndex: 0.8, bestRawMs: 51_000, bestPaxMs: 40_800 }),
    ];

    const [m] = summarizeEventClasses(rows, true);
    expect(m?.winner?.driverId).toBe(2);
    expect(m?.winner?.bestRawMs).toBe(51_000);
  });

  it("reports a null winner when no entry in the class has a time", () => {
    const rows = [row({ bestRawMs: null, bestPaxMs: null })];
    expect(summarizeEventClasses(rows, false)).toEqual([
      { classCode: "SS", entryCount: 1, winner: null },
    ]);
  });
});

describe("filterRowsForClass", () => {
  const rows = [
    row({ driverId: 1, classCode: "SS" }),
    row({ driverId: 2, classCode: "AS" }),
    row({ driverId: 3, classCode: "SS" }),
  ];

  it("matches case-insensitively and returns the canonical class code", () => {
    const res = filterRowsForClass(rows, "ss");
    expect(res?.classCode).toBe("SS");
    expect(res?.rows.map((r) => r.driverId)).toEqual([1, 3]);
  });

  it("trims the param before matching", () => {
    expect(filterRowsForClass(rows, " as ")?.classCode).toBe("AS");
  });

  it("returns null for unknown or blank classes", () => {
    expect(filterRowsForClass(rows, "XX")).toBeNull();
    expect(filterRowsForClass(rows, "")).toBeNull();
  });
});
