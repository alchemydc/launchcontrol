import { describe, it, expect } from "vitest";
import { bestCorrectedMsForEntry, type EntryForBest } from "@/lib/entry-best";
import { CONE_PENALTY_MS } from "@/lib/constants";

// Pure-function unit tests — no Prisma, no DB.

describe("bestCorrectedMsForEntry()", () => {
  it("committed → CLEAN R2 with no cones: returns that run's time", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: 2,
      runs: [
        { runNumber: 1, rawTimeMs: 55000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 52000, cones: 0, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 51000, cones: 0, disposition: "CLEAN" },
      ],
    };
    expect(bestCorrectedMsForEntry(entry)).toBe(52000);
  });

  it("committed → CLEAN R2 with 2 cones: returns time + 2 × CONE_PENALTY_MS", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: 2,
      runs: [
        { runNumber: 1, rawTimeMs: 55000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 50000, cones: 2, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 48000, cones: 0, disposition: "CLEAN" },
      ],
    };
    expect(bestCorrectedMsForEntry(entry)).toBe(50000 + 2 * CONE_PENALTY_MS);
  });

  it("committed → DSQ R2 with rawTimeMs set: falls back to fastest CLEAN (regression guard)", () => {
    // This is the critical case: committed pointer targets a DSQ run that has a time.
    // Without the disposition guard, the old code would return 49000 (the DSQ time).
    // With the guard, it must fall back to fastest CLEAN.
    const entry: EntryForBest = {
      bestCommittedRunNumber: 2,
      runs: [
        { runNumber: 1, rawTimeMs: 55000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 49000, cones: 0, disposition: "DSQ" },
        { runNumber: 3, rawTimeMs: 53000, cones: 0, disposition: "CLEAN" },
      ],
    };
    // R1 (55000) and R3 (53000) are CLEAN; fastest is R3 = 53000.
    expect(bestCorrectedMsForEntry(entry)).toBe(53000);
  });

  it("committed → RRN R2 with rawTimeMs set: falls back to fastest CLEAN", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: 2,
      runs: [
        { runNumber: 1, rawTimeMs: 60000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 51000, cones: 0, disposition: "RRN" },
        { runNumber: 3, rawTimeMs: 58000, cones: 0, disposition: "CLEAN" },
      ],
    };
    // R1 (60000) and R3 (58000) are CLEAN; fastest is R3 = 58000.
    expect(bestCorrectedMsForEntry(entry)).toBe(58000);
  });

  it("committed → run number not in runs[]: falls back to fastest CLEAN", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: 5,
      runs: [
        { runNumber: 1, rawTimeMs: 62000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 59000, cones: 0, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 65000, cones: 0, disposition: "CLEAN" },
      ],
    };
    expect(bestCorrectedMsForEntry(entry)).toBe(59000);
  });

  it("committed → CLEAN R2 but rawTimeMs is null: falls back to fastest CLEAN", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: 2,
      runs: [
        { runNumber: 1, rawTimeMs: 57000, cones: 0, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: null, cones: 0, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 54000, cones: 0, disposition: "CLEAN" },
      ],
    };
    // R2 is CLEAN but has no time; fastest of R1 and R3 is R3 = 54000.
    expect(bestCorrectedMsForEntry(entry)).toBe(54000);
  });

  it("bestCommittedRunNumber === null, 3 CLEAN runs: returns fastest corrected time", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: null,
      runs: [
        { runNumber: 1, rawTimeMs: 63000, cones: 1, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 60000, cones: 0, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 59000, cones: 1, disposition: "CLEAN" },
      ],
    };
    // Corrected: R1 = 63000 + 2000 = 65000, R2 = 60000, R3 = 59000 + 2000 = 61000.
    // Fastest corrected = R2 = 60000.
    expect(bestCorrectedMsForEntry(entry)).toBe(60000);
  });

  it("bestCommittedRunNumber === null, all runs non-CLEAN: returns null", () => {
    const entry: EntryForBest = {
      bestCommittedRunNumber: null,
      runs: [
        { runNumber: 1, rawTimeMs: null, cones: 0, disposition: "DNF" },
        { runNumber: 2, rawTimeMs: 50000, cones: 0, disposition: "DSQ" },
        { runNumber: 3, rawTimeMs: null, cones: 0, disposition: "OFF" },
      ],
    };
    expect(bestCorrectedMsForEntry(entry)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// penaltyMs (League Foundation PR 2 Task 7) — per-season cone penalty
// threading. Every test above omits the argument and must keep passing
// unchanged (parity: default === CONE_PENALTY_MS).
// ---------------------------------------------------------------------------

describe("bestCorrectedMsForEntry() — explicit penaltyMs", () => {
  const entry: EntryForBest = {
    bestCommittedRunNumber: 2,
    runs: [
      { runNumber: 1, rawTimeMs: 55000, cones: 0, disposition: "CLEAN" },
      { runNumber: 2, rawTimeMs: 50000, cones: 2, disposition: "CLEAN" },
      { runNumber: 3, rawTimeMs: 48000, cones: 0, disposition: "CLEAN" },
    ],
  };

  it("defaults to CONE_PENALTY_MS when no penaltyMs is given", () => {
    expect(bestCorrectedMsForEntry(entry)).toBe(50000 + 2 * CONE_PENALTY_MS);
  });

  it("an explicit penaltyMs equal to the constant matches the default (parity)", () => {
    expect(bestCorrectedMsForEntry(entry, CONE_PENALTY_MS)).toBe(bestCorrectedMsForEntry(entry));
  });

  it("a smaller penaltyMs (e.g. a 1000ms-penalty season) scores this entry faster", () => {
    expect(bestCorrectedMsForEntry(entry, 1000)).toBe(50000 + 2 * 1000);
    expect(bestCorrectedMsForEntry(entry, 1000)).toBeLessThan(bestCorrectedMsForEntry(entry, 2000)!);
  });

  it("threads penaltyMs through the fallback (non-committed) fastest-CLEAN path too", () => {
    const noCommitted: EntryForBest = {
      bestCommittedRunNumber: null,
      runs: [
        { runNumber: 1, rawTimeMs: 63000, cones: 1, disposition: "CLEAN" },
        { runNumber: 2, rawTimeMs: 60000, cones: 0, disposition: "CLEAN" },
        { runNumber: 3, rawTimeMs: 59000, cones: 1, disposition: "CLEAN" },
      ],
    };
    // At the default 2000ms penalty, R2 (60000) beats R3 (59000+2000=61000).
    expect(bestCorrectedMsForEntry(noCommitted)).toBe(60000);
    // At a 1000ms penalty, R3 (59000+1000=60000) ties R2 flat, but at 500ms
    // R3 pulls ahead — proving the penalty value actually drives the result.
    expect(bestCorrectedMsForEntry(noCommitted, 500)).toBe(59500);
  });
});
