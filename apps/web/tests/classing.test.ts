import { describe, expect, it } from "vitest";
import {
  classVehicleLines,
  classingForSeason,
  formatVehicleLabel,
  lookupClass,
  lookupModels,
  lookupTrims,
  lookupYears,
  parseClassingModel,
  vehicleLineText,
  type ClassingModel,
} from "@/lib/classing";
import {
  classingHints,
  classingHintsByKey,
  getClassingModel,
  hasClassingModel,
} from "@/lib/classing-registry";

// Synthetic model, shaped after the real one's hard cases but naming no real
// upstream data beyond the class codes. Covers: a type == model vehicle, a
// generation pair whose trims MATCH (collapsible), a generation pair whose
// trims DIFFER (must not collapse), an open-ended range, a displacement
// condition, and a per-season class reassignment.
const MODEL: ClassingModel = parseClassingModel({
  organization: "Test Region",
  eventType: "Autocross",
  generatedAt: "2026-01-01",
  vehicles: [
    {
      type: "944",
      model: "944",
      version: null,
      years: { from: 1983, to: 1991 },
      trims: [{ trim: "all", displacementMax: null, classing: [{ classCode: "C1", seasons: [2025, 2026] }] }],
    },
    {
      type: "G-Series",
      model: "911",
      version: null,
      years: { from: 1974, to: 1988 },
      trims: [
        { trim: "base", displacementMax: null, classing: [{ classCode: "C1", seasons: [2025, 2026] }] },
        { trim: "Turbo", displacementMax: "3.3L", classing: [{ classCode: "C1", seasons: [2025, 2026] }] },
      ],
    },
    // Same trims across both halves -> collapses to one "996 911 1999-2004" line.
    {
      type: "996",
      model: "911",
      version: ".1",
      years: { from: 1999, to: 2001 },
      trims: [{ trim: "S", displacementMax: null, classing: [{ classCode: "C3", seasons: [2025, 2026] }] }],
    },
    {
      type: "996",
      model: "911",
      version: ".2",
      years: { from: 2002, to: 2004 },
      trims: [{ trim: "S", displacementMax: null, classing: [{ classCode: "C3", seasons: [2025, 2026] }] }],
    },
    // Different trims across halves -> must stay two lines.
    {
      type: "987",
      model: "Cayman",
      version: ".1",
      years: { from: 2005, to: 2008 },
      trims: [{ trim: "S", displacementMax: null, classing: [{ classCode: "C3", seasons: [2025, 2026] }] }],
    },
    {
      type: "987",
      model: "Cayman",
      version: ".2",
      years: { from: 2009, to: 2012 },
      trims: [
        { trim: "S", displacementMax: null, classing: [{ classCode: "C3", seasons: [2025, 2026] }] },
        { trim: "R", displacementMax: null, classing: [{ classCode: "C3", seasons: [2025, 2026] }] },
      ],
    },
    // Open-ended, and reclassified between seasons.
    {
      type: "Taycan",
      model: "Taycan",
      version: null,
      years: { from: 2020, to: null },
      trims: [
        {
          trim: "all",
          displacementMax: null,
          classing: [
            { classCode: "C5", seasons: [2025] },
            { classCode: "CS", seasons: [2026] },
          ],
        },
      ],
    },
  ],
});

describe("parseClassingModel", () => {
  const valid = {
    organization: "R",
    eventType: "Autocross",
    generatedAt: "2026-01-01",
    vehicles: [
      {
        type: "911",
        model: "911",
        version: null,
        years: { from: 1990, to: 1994 },
        trims: [{ trim: "all", displacementMax: null, classing: [{ classCode: "C1", seasons: [2026] }] }],
      },
    ],
  };

  it("accepts a well-formed model", () => {
    expect(parseClassingModel(valid).vehicles).toHaveLength(1);
  });

  it("names the offending path on a bad year", () => {
    const bad = structuredClone(valid);
    // @ts-expect-error deliberately malformed
    bad.vehicles[0].years.from = "1990";
    expect(() => parseClassingModel(bad)).toThrow(/vehicles\[0\]\.years\.from must be a 4-digit year/);
  });

  it("rejects an inverted year range", () => {
    const bad = structuredClone(valid);
    bad.vehicles[0]!.years = { from: 1994, to: 1990 };
    expect(() => parseClassingModel(bad)).toThrow(/vehicles\[0\]\.years\.to must be >= /);
  });

  it("rejects a class assignment with no seasons", () => {
    const bad = structuredClone(valid);
    bad.vehicles[0]!.trims[0]!.classing[0]!.seasons = [];
    expect(() => parseClassingModel(bad)).toThrow(
      /vehicles\[0\]\.trims\[0\]\.classing\[0\]\.seasons must be a non-empty array/,
    );
  });

  it("rejects a vehicle with no trims", () => {
    const bad = structuredClone(valid);
    bad.vehicles[0]!.trims = [];
    expect(() => parseClassingModel(bad)).toThrow(/vehicles\[0\]\.trims must be a non-empty array/);
  });

  it("rejects a model with no vehicles", () => {
    expect(() => parseClassingModel({ ...valid, vehicles: [] })).toThrow(
      /vehicles must be a non-empty array/,
    );
  });
});

describe("formatVehicleLabel", () => {
  const years = { from: 2020, to: 2024 };

  it("prints the model alone when the body code IS the model", () => {
    expect(
      formatVehicleLabel({ type: "944", model: "944", version: null, years }, []).title,
    ).toBe("944");
  });

  it("prefixes the body code when it differs from the model", () => {
    expect(
      formatVehicleLabel({ type: "G-Series", model: "911", version: null, years }, []).title,
    ).toBe("G-Series 911");
  });

  it("folds the generation half into the body code", () => {
    expect(
      formatVehicleLabel({ type: "996", model: "911", version: ".2", years }, []).title,
    ).toBe("996.2 911");
  });

  it("renders a closed year range and an open-ended one", () => {
    expect(formatVehicleLabel({ type: "a", model: "b", version: null, years }, []).years).toBe(
      "2020-2024",
    );
    expect(
      formatVehicleLabel(
        { type: "a", model: "b", version: null, years: { from: 2020, to: null } },
        [],
      ).years,
    ).toBe("2020+");
  });

  it("orders trims by performance, not alphabetically", () => {
    const line = formatVehicleLabel({ type: "992", model: "911", version: null, years }, [
      { name: "Turbo S", displacementMax: null },
      { name: "base", displacementMax: null },
      { name: "GTS", displacementMax: null },
      { name: "S", displacementMax: null },
    ]);
    expect(line.trims.map((t) => t.name)).toEqual(["base", "S", "GTS", "Turbo S"]);
  });

  it("carries a displacement condition through to the rendered line", () => {
    const line = formatVehicleLabel(
      { type: "G-Series", model: "911", version: null, years: { from: 1974, to: 1988 } },
      [
        { name: "base", displacementMax: null },
        { name: "Turbo", displacementMax: "3.3L" },
      ],
    );
    expect(vehicleLineText(line)).toBe("G-Series 911 · base, Turbo (max 3.3L) · 1974-1988");
  });
});

describe("classingForSeason", () => {
  const lines = (year: number, code: string) =>
    (classingForSeason(MODEL, year).find((s) => s.classCode === code)?.vehicles ?? []).map(
      vehicleLineText,
    );

  it("unions the trims of one vehicle into a single line", () => {
    expect(lines(2026, "C1")).toEqual([
      "944 · 1983-1991",
      "G-Series 911 · base, Turbo (max 3.3L) · 1974-1988",
    ]);
  });

  it("collapses generation halves that share a trim list, merging their years", () => {
    expect(lines(2026, "C3")).toContain("996 911 · S · 1999-2004");
  });

  it("keeps generation halves separate when their trims differ", () => {
    expect(lines(2026, "C3")).toEqual(
      expect.arrayContaining(["987.1 Cayman · S · 2005-2008", "987.2 Cayman · S, R · 2009-2012"]),
    );
  });

  it("honours a per-season class reassignment", () => {
    expect(lines(2025, "C5")).toEqual(["Taycan · 2020+"]);
    expect(lines(2025, "CS")).toEqual([]);
    expect(lines(2026, "C5")).toEqual([]);
    expect(lines(2026, "CS")).toEqual(["Taycan · 2020+"]);
  });

  it("returns nothing for a season the model does not cover", () => {
    expect(classingForSeason(MODEL, 2030)).toEqual([]);
  });

  it("sorts classes by code", () => {
    expect(classingForSeason(MODEL, 2026).map((s) => s.classCode)).toEqual([
      "C1",
      "C3",
      "CS",
    ]);
  });
});

describe("classVehicleLines", () => {
  it("agrees with the table it is derived from", () => {
    const map = classVehicleLines(MODEL, 2026);
    expect(map.C1).toEqual(["944 · 1983-1991", "G-Series 911 · base, Turbo (max 3.3L) · 1974-1988"]);
    expect(map.C5).toBeUndefined();
  });
});

describe("lookup", () => {
  it("offers only models with an assignment in the season", () => {
    expect(lookupModels(MODEL, 2026)).toEqual(["911", "944", "Cayman", "Taycan"]);
  });

  it("caps an open-ended vehicle's years at the season being viewed", () => {
    expect(lookupYears(MODEL, 2026, "Taycan", 2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  });

  it("offers the trims available for a model-year", () => {
    expect(lookupTrims(MODEL, 2026, "Cayman", 2010)).toEqual(["S", "R"]);
    expect(lookupTrims(MODEL, 2026, "Cayman", 2006)).toEqual(["S"]);
  });

  it("resolves a single match", () => {
    const matches = lookupClass(MODEL, {
      modelName: "Cayman",
      year: 2010,
      trim: "R",
      season: 2026,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.classCode).toBe("C3");
    expect(vehicleLineText(matches[0]!.vehicle)).toBe("987.2 Cayman · R · 2009-2012");
  });

  it("surfaces the displacement condition on the matched trim", () => {
    const matches = lookupClass(MODEL, { modelName: "911", year: 1980, trim: "Turbo", season: 2026 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.displacementMax).toBe("3.3L");
  });

  it("returns no match outside the vehicle's year range", () => {
    expect(lookupClass(MODEL, { modelName: "Taycan", year: 2019, trim: "all", season: 2026 })).toEqual([]);
  });

  it("includes both boundary years", () => {
    for (const year of [2009, 2012]) {
      expect(
        lookupClass(MODEL, { modelName: "Cayman", year, trim: "R", season: 2026 }),
      ).toHaveLength(1);
    }
    expect(
      lookupClass(MODEL, { modelName: "Cayman", year: 2013, trim: "R", season: 2026 }),
    ).toEqual([]);
  });

  it("resolves the season-reassigned model to the right class per season", () => {
    const at = (season: number) =>
      lookupClass(MODEL, { modelName: "Taycan", year: 2022, trim: "all", season }).map(
        (m) => m.classCode,
      );
    expect(at(2025)).toEqual(["C5"]);
    expect(at(2026)).toEqual(["CS"]);
  });
});

describe("classing registry", () => {
  it("does not report a classing model for inherited Object keys", () => {
    // League slugs are operator-supplied and never validated against this
    // registry, so a plain `in`/`[]` lookup would report a model for a league
    // named `toString` and then hand back a function to render.
    for (const slug of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(hasClassingModel(slug)).toBe(false);
      expect(getClassingModel(slug)).toBeNull();
    }
  });

  it("keys hints by season slug, not year, so same-year seasons stay distinct", () => {
    const rows = [
      { leagueSlug: "pca-rmr", seasonYear: 2026, seasonSlug: "2026" },
      { leagueSlug: "pca-rmr", seasonYear: 2026, seasonSlug: "2026-winter" },
    ];
    const byKey = classingHintsByKey(rows, () => "");
    expect(Object.keys(byKey).sort()).toEqual([
      "pca-rmr|2026",
      "pca-rmr|2026-winter",
    ]);
    // Same year => same vehicle lines (the rulebook is year-indexed), but each
    // carries its own slug so the guide link lands on the right season.
    expect(byKey["pca-rmr|2026"]!.vehicles).toEqual(byKey["pca-rmr|2026-winter"]!.vehicles);
    expect(byKey["pca-rmr|2026-winter"]!.seasonSlug).toBe("2026-winter");
  });

  it("carries the requested season slug into the hints", () => {
    const hints = classingHints({
      leagueSlug: "pca-rmr",
      year: 2026,
      seasonLabel: "2026 Season",
      seasonSlug: "2026",
      basePath: "/l/pca-rmr",
    });
    expect(hints?.seasonSlug).toBe("2026");
    expect(hints?.basePath).toBe("/l/pca-rmr");
  });
});

describe("vehicles with no year range", () => {
  // Upstream's `non-Porsche` -> TO row: a class defined by what a car ISN'T has
  // no model years to bound, so the whole `years:` block is absent.
  const ANY: ClassingModel = parseClassingModel({
    organization: "R",
    eventType: "Autocross",
    generatedAt: "2026-01-01",
    vehicles: [
      {
        type: "non-Porsche",
        model: "non-Porsche",
        version: null,
        years: null,
        trims: [
          { trim: "all", displacementMax: null, classing: [{ classCode: "TO", seasons: [2026] }] },
        ],
      },
    ],
  });

  it("parses an absent years block as null rather than rejecting it", () => {
    expect(ANY.vehicles[0]!.years).toBeNull();
  });

  it("renders the line bare, with no year part", () => {
    const line = classingForSeason(ANY, 2026)[0]!.vehicles[0]!;
    expect(line.years).toBeNull();
    expect(vehicleLineText(line)).toBe("non-Porsche");
  });

  it("covers every year in lookup", () => {
    for (const year of [1965, 2026, 2200]) {
      expect(
        lookupClass(ANY, { modelName: "non-Porsche", year, trim: "all", season: 2026 }).map(
          (m) => m.classCode,
        ),
      ).toEqual(["TO"]);
    }
  });

  it("offers no years to enumerate, which is what makes the picker say 'Any year'", () => {
    expect(lookupModels(ANY, 2026)).toEqual(["non-Porsche"]);
    expect(lookupYears(ANY, 2026, "non-Porsche", 2026)).toEqual([]);
  });

  it("does not narrow a merged line when collapsed against a bounded sibling", () => {
    // An unbounded source swallows the range, the same way an open `to` does —
    // a merged line must never read as narrower than its sources.
    const mixed = parseClassingModel({
      organization: "R",
      eventType: "Autocross",
      generatedAt: "2026-01-01",
      vehicles: [
        {
          type: "X",
          model: "X",
          version: ".1",
          years: { from: 2000, to: 2004 },
          trims: [
            { trim: "all", displacementMax: null, classing: [{ classCode: "C1", seasons: [2026] }] },
          ],
        },
        {
          type: "X",
          model: "X",
          version: ".2",
          years: null,
          trims: [
            { trim: "all", displacementMax: null, classing: [{ classCode: "C1", seasons: [2026] }] },
          ],
        },
      ],
    });
    const lines = classingForSeason(mixed, 2026)[0]!.vehicles;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.years).toBeNull();
  });
});
