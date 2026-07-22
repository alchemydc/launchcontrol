import { describe, expect, it } from "vitest";
import { RMSOLO_PAX_2026, getRmsoloPaxIndex } from "@/lib/rmsolo-pax";

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
    expect(getRmsoloPaxIndex("XU")).toBe(1.0);
  });
});
