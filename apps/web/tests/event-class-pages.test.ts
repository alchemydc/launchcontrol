import { describe, expect, it } from "vitest";

import {
  availableEventViews,
  classUsesPaxMetric,
  filterRowsForClass,
  resolveEventView,
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

describe("resolveEventView", () => {
  const rows = [
    row({ driverId: 1, classCode: "SS", paxIndex: 0.83 }),
    row({ driverId: 2, classCode: "AS", paxIndex: 0.82 }),
    row({ driverId: 3, classCode: "SS", paxIndex: 0.83 }),
  ];

  it("resolves a real class to just that class's rows, ranked on raw time", () => {
    const view = resolveEventView(rows, "ss", true);
    expect(view).toEqual({
      rows: [rows[0], rows[2]],
      label: "SS",
      paxView: false, // homogeneous factor — raw and indexed order identically
      navActive: "SS",
    });
  });

  it("ranks a heterogeneous run-group class on the indexed metric", () => {
    const runGroup = [
      row({ driverId: 1, classCode: "X", paxIndex: 0.81 }),
      row({ driverId: 2, classCode: "X", paxIndex: 0.84 }),
    ];
    expect(resolveEventView(runGroup, "X", true)?.paxView).toBe(true);
  });

  it("resolves the PAX view to every row, ranked on the indexed metric", () => {
    const view = resolveEventView(rows, "pax", true);
    expect(view?.rows).toEqual(rows);
    expect(view?.paxView).toBe(true);
    expect(view?.navActive).toBe("pax");
  });

  it("hides the PAX view when the ruleset has PAX standings off", () => {
    expect(resolveEventView(rows, "pax", false)).toBeNull();
  });

  // The raw view is what the pre-#99 "All Raw" / "All" filter chip showed:
  // every entry at the event in one list, ranked on raw time. It is NOT gated
  // on PAX standings — a league with the PAX section off still gets the
  // unfiltered list, it is just labelled "All" rather than "All Raw".
  it("resolves the raw view to every row, ranked on raw time", () => {
    const view = resolveEventView(rows, "raw", true);
    expect(view).toEqual({
      rows,
      label: "All raw times",
      paxView: false,
      navActive: "raw",
    });
  });

  it("offers the raw view even when PAX standings are off", () => {
    expect(resolveEventView(rows, "raw", false)?.navActive).toBe("raw");
  });

  it("matches the virtual views case-insensitively and trims the param", () => {
    expect(resolveEventView(rows, " RAW ", true)?.navActive).toBe("raw");
    expect(resolveEventView(rows, " Pax ", true)?.navActive).toBe("pax");
  });

  // Same precedent as the season leaderboard's synthetic PAX section: a real
  // class of that name wins outright, never silently merged with the virtual
  // view of the same name.
  it("lets a real class named RAW or PAX win over the virtual view", () => {
    const withReal = [
      row({ driverId: 1, classCode: "RAW" }),
      row({ driverId: 2, classCode: "PAX" }),
      row({ driverId: 3, classCode: "SS" }),
    ];
    const raw = resolveEventView(withReal, "raw", true);
    expect(raw?.rows.map((r) => r.driverId)).toEqual([1]);
    expect(raw?.label).toBe("RAW");
    const pax = resolveEventView(withReal, "pax", true);
    expect(pax?.rows.map((r) => r.driverId)).toEqual([2]);
    expect(pax?.label).toBe("PAX");
  });

  it("returns null for an unknown or blank view", () => {
    expect(resolveEventView(rows, "XX", true)).toBeNull();
    expect(resolveEventView(rows, "", true)).toBeNull();
  });
});

// The nav counterpart to resolveEventView's real-class-first precedence: a
// pill for a virtual view a real class has taken over would link to that class
// page and never read as active, so it is not offered at all.
describe("availableEventViews", () => {
  const rows = [
    row({ driverId: 1, classCode: "SS" }),
    row({ driverId: 2, classCode: "AS" }),
  ];

  it("offers both virtual views when no real class shadows them", () => {
    expect(availableEventViews(rows, true)).toEqual({ raw: true, pax: true });
  });

  it("still offers the raw view when PAX standings are off", () => {
    expect(availableEventViews(rows, false)).toEqual({ raw: true, pax: false });
  });

  it("drops the raw pill when a real class named RAW owns that segment", () => {
    const withRealRaw = [...rows, row({ driverId: 3, classCode: "RAW" })];
    expect(availableEventViews(withRealRaw, true)).toEqual({ raw: false, pax: true });
    // ...and that is exactly the segment resolveEventView hands to the class.
    expect(resolveEventView(withRealRaw, "raw", true)?.label).toBe("RAW");
  });

  it("drops the PAX pill when a real class named PAX owns that segment", () => {
    const withRealPax = [...rows, row({ driverId: 3, classCode: "PAX" })];
    expect(availableEventViews(withRealPax, true)).toEqual({ raw: true, pax: false });
    expect(resolveEventView(withRealPax, "pax", true)?.label).toBe("PAX");
  });

  it("matches shadowing class codes case-insensitively", () => {
    const lowercase = [...rows, row({ driverId: 3, classCode: "raw" })];
    expect(availableEventViews(lowercase, true).raw).toBe(false);
  });
});
