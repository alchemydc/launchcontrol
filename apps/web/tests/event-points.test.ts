import { describe, expect, it } from "vitest";
import { awardPoints } from "@/lib/event-points";
import type { PointsSystem } from "@/lib/scoring-policy";

const RATIO: PointsSystem = { type: "ratio1000", basis: "class" };
const POSITION: PointsSystem = {
  type: "position",
  table: [20, 15, 12],
  beyondTable: 1,
  basis: "class",
};

function metrics(entries: Array<[number, number]>): Map<number, number> {
  return new Map(entries);
}

describe("awardPoints — ratio1000", () => {
  it("gives the fastest driver 1000 and scales the rest", () => {
    // Real indexed times from the season-pax fixture: 40000ms × 0.83 and
    // 42000ms × 0.83.
    const result = awardPoints(metrics([[1, 33200], [2, 34860]]), RATIO);
    expect(result.get(1)).toBe(1000);
    expect(result.get(2)).toBe(952); // round(1000 × 33200 / 34860)
  });

  it("scores fractional metrics at full precision", () => {
    // 39900ms × 0.835 = 33316.5 exactly — rounding the metric first would
    // give 996 instead of 997.
    const result = awardPoints(metrics([[1, 33200], [2, 33316.5]]), RATIO);
    expect(result.get(2)).toBe(997);
  });

  it("returns an empty map for an empty population", () => {
    expect(awardPoints(metrics([]), RATIO).size).toBe(0);
  });
});

describe("awardPoints — position", () => {
  it("maps finishing position onto the table", () => {
    const result = awardPoints(metrics([[3, 300], [1, 100], [2, 200]]), POSITION);
    expect(result.get(1)).toBe(20);
    expect(result.get(2)).toBe(15);
    expect(result.get(3)).toBe(12);
  });

  it("awards beyondTable to every position past the end of the table", () => {
    const result = awardPoints(
      metrics([[1, 100], [2, 200], [3, 300], [4, 400], [5, 500]]),
      POSITION,
    );
    expect(result.get(4)).toBe(1);
    expect(result.get(5)).toBe(1);
  });

  it("gives tied drivers the higher position's points and skips the position after", () => {
    // Two tied for 1st both score 20; the next driver is 3rd, not 2nd.
    const result = awardPoints(metrics([[1, 100], [2, 100], [3, 300]]), POSITION);
    expect(result.get(1)).toBe(20);
    expect(result.get(2)).toBe(20);
    expect(result.get(3)).toBe(12);
  });

  it("handles a three-way tie at the top", () => {
    const table: PointsSystem = {
      type: "position",
      table: [20, 15, 12, 10],
      beyondTable: 1,
      basis: "class",
    };
    const result = awardPoints(
      metrics([[1, 100], [2, 100], [3, 100], [4, 200]]),
      table,
    );
    expect([result.get(1), result.get(2), result.get(3)]).toEqual([20, 20, 20]);
    expect(result.get(4)).toBe(10); // 4th place
  });

  it("handles a tie in the middle of the table — solo 1st, a two-way tie for 2nd/3rd, solo 4th", () => {
    const table: PointsSystem = {
      type: "position",
      table: [20, 15, 12, 10],
      beyondTable: 1,
      basis: "class",
    };
    const result = awardPoints(
      metrics([[1, 100], [2, 200], [3, 200], [4, 300]]),
      table,
    );
    expect(result.get(1)).toBe(20);
    expect(result.get(2)).toBe(15);
    expect(result.get(3)).toBe(15);
    expect(result.get(4)).toBe(10); // 4th place, not 3rd
  });

  it("ties on whole indexed milliseconds, so float noise does not split a tie", () => {
    const result = awardPoints(metrics([[1, 100.2], [2, 100.4]]), POSITION);
    expect(result.get(1)).toBe(20);
    expect(result.get(2)).toBe(20);
  });

  it("returns an empty map for an empty population", () => {
    expect(awardPoints(metrics([]), POSITION).size).toBe(0);
  });
});
