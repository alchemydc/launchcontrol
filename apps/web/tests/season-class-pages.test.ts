import { describe, expect, it } from "vitest";

import {
  findSeasonSection,
  summarizeSeasonSections,
  type SeasonStandingsByClass,
  type SeasonStandingsRow,
} from "@/lib/season-leaderboard";

function row(overrides: Partial<SeasonStandingsRow> = {}): SeasonStandingsRow {
  return {
    driverId: 1,
    driverName: "Alice A.",
    totalPoints: 1000,
    averagePoints: 1000,
    eligible: true,
    eventsCountedInClass: 3,
    qualifyingEvents: 4,
    scores: [],
    ...overrides,
  };
}

function section(
  classCode: string,
  drivers: SeasonStandingsRow[],
): SeasonStandingsByClass {
  return { classCode, drivers };
}

describe("summarizeSeasonSections", () => {
  it("maps sections to summaries preserving input order", () => {
    const sections = [
      section("PAX", [
        row({ driverId: 7, driverName: "Cara C.", totalPoints: 2990 }),
        row({ driverId: 8, driverName: "Dave D.", totalPoints: 2870 }),
      ]),
      section("AS", [row({ driverId: 3, driverName: "Bob B.", totalPoints: 1900 })]),
    ];

    expect(summarizeSeasonSections(sections)).toEqual([
      {
        classCode: "PAX",
        driverCount: 2,
        leader: { driverId: 7, driverName: "Cara C.", totalPoints: 2990 },
      },
      {
        classCode: "AS",
        driverCount: 1,
        leader: { driverId: 3, driverName: "Bob B.", totalPoints: 1900 },
      },
    ]);
  });

  it("skips sections with no drivers", () => {
    const sections = [section("SS", []), section("BS", [row()])];
    const summaries = summarizeSeasonSections(sections);
    expect(summaries.map((s) => s.classCode)).toEqual(["BS"]);
  });

  it("returns an empty array for no sections", () => {
    expect(summarizeSeasonSections([])).toEqual([]);
  });
});

describe("findSeasonSection", () => {
  const sections = [
    section("PAX", [row()]),
    section("SS", [row({ driverId: 2 })]),
  ];

  it("matches class codes case-insensitively", () => {
    expect(findSeasonSection(sections, "ss")?.classCode).toBe("SS");
    expect(findSeasonSection(sections, "SS")?.classCode).toBe("SS");
    expect(findSeasonSection(sections, "pax")?.classCode).toBe("PAX");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(findSeasonSection(sections, " ss ")?.classCode).toBe("SS");
  });

  it("returns null for unknown or empty class params", () => {
    expect(findSeasonSection(sections, "NOPE")).toBeNull();
    expect(findSeasonSection(sections, "")).toBeNull();
    expect(findSeasonSection(sections, "   ")).toBeNull();
  });
});
