import { describe, expect, it, vi } from "vitest";
import {
  RMSOLO_PAX_2026,
  getRmsoloPaxIndex,
  nearestPaxClass,
  parseSeasonPaxTable,
  resolveRulesetPaxIndex,
} from "@/lib/rmsolo-pax";

describe("RMsolo PAX table", () => {
  it("covers every class code seen in the 2026 Full-PDF fixture", () => {
    const fixtureClasses = ["AS", "AST", "BS", "BST", "CS", "CST", "DS", "DST",
      "ES", "GS", "GST", "HS", "SS", "SSC", "SST", "CAMC", "CAMS", "CAMT"];
    for (const code of fixtureClasses) {
      expect(RMSOLO_PAX_2026[code], `missing PAX for ${code}`).toBeDefined();
    }
  });

  it("all factors are plausible (0.7 < pax <= 1.0)", () => {
    for (const [code, pax] of Object.entries(RMSOLO_PAX_2026)) {
      expect(pax, code).toBeGreaterThan(0.7);
      expect(pax, code).toBeLessThanOrEqual(1.0);
    }
  });

  it("unknown classes fall back to 1.0", () => {
    expect(getRmsoloPaxIndex("N")).toBe(1.0);
  });
});

describe("2026 season-sheet reconciliation additions", () => {
  // Sourced from the club's own "RmSolo 2026 Unofficial Season Points" sheet
  // (Index column, SS1-SS5), cross-checked against the 2026 SCCA PAX table.
  const SHEET_SOURCED: Record<string, number> = {
    AM: 1.0,
    CP: 0.862,
    CSP: 0.858,
    CSX: 0.803,
    DM: 0.906,
    EP: 0.865,
    EST: 0.815,
  };

  it("includes every class the club season sheet scores", () => {
    for (const [code, pax] of Object.entries(SHEET_SOURCED)) {
      expect(RMSOLO_PAX_2026[code], `missing/${code}`).toBe(pax);
    }
  });

  it("nearestPaxClass matches a derived factor to its class", () => {
    // David Fauth, SS1: printed indexed Best 33.460 / raw best 40.024 = 0.83600 → AST
    expect(nearestPaxClass(33.46 / 40.024)).toEqual({ code: "AST", pax: 0.836 });
    // Bud Smith (M run group): 37.037 / 40.389 = 0.91700… → FM
    expect(nearestPaxClass(37.037 / 40.389)).toEqual({ code: "FM", pax: 0.917 });
  });

  it("nearestPaxClass rejects factors far from any class", () => {
    expect(nearestPaxClass(0.5)).toBeNull();
    expect(nearestPaxClass(1.0 - 0.05)).toBeNull();
  });
});

describe("parseSeasonPaxTable", () => {
  it("parses a well-formed JSON object", () => {
    expect(parseSeasonPaxTable('{"AS": 0.5, "BS": 0.6}')).toEqual({ AS: 0.5, BS: 0.6 });
  });

  it("parses the schema default '{}' as an empty table", () => {
    expect(parseSeasonPaxTable("{}")).toEqual({});
  });

  it("warns and returns {} for invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSeasonPaxTable("not json")).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not a valid JSON object"));
    warnSpy.mockRestore();
  });

  it("warns and returns {} for a JSON array or scalar", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSeasonPaxTable("[1,2,3]")).toEqual({});
    expect(parseSeasonPaxTable("42")).toEqual({});
    warnSpy.mockRestore();
  });

  it("drops a non-finite-number entry with a warning, so the class resolves to 1.0 like an unlisted one", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSeasonPaxTable('{"AS":"abc"}')).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'AS' is not a finite number"));
    warnSpy.mockRestore();
  });

  it("keeps well-formed entries alongside a dropped one", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSeasonPaxTable('{"AS": 0.5, "BS": "bad", "CS": null}')).toEqual({ AS: 0.5 });
    warnSpy.mockRestore();
  });
});

describe("resolveRulesetPaxIndex — ruleset table is the only read-time source", () => {
  it("returns the ruleset table's factor for a listed class", () => {
    expect(RMSOLO_PAX_2026.AS).not.toBe(0.5); // sanity: differs from the built-in value
    expect(resolveRulesetPaxIndex("AS", { AS: 0.5 })).toBe(0.5);
  });

  it("does NOT fall back to the built-in table — an unlisted class resolves to 1.0 (with a one-shot warning)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveRulesetPaxIndex("AS", { BS: 0.9 })).toBe(1.0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no factor for class 'AS'"));
    warnSpy.mockRestore();
  });

  it("resolves 1.0 (with a warning) for a class listed nowhere", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveRulesetPaxIndex("ZZZ-UNKNOWN", {})).toBe(1.0);
    warnSpy.mockRestore();
  });
});
