import { describe, expect, it } from "vitest";
import { RMSOLO_PAX_2026 } from "@/lib/rmsolo-pax";
import { buildPaxRows, canonicalPaxJson, serializePaxOverrides } from "@/lib/pax-table-edit";

describe("buildPaxRows", () => {
  it("with no overrides, every builtin code is present and unoverridden", () => {
    const rows = buildPaxRows("{}");
    const builtinCodes = Object.keys(RMSOLO_PAX_2026).sort();
    expect(rows.map((r) => r.code)).toEqual(builtinCodes);
    for (const row of rows) {
      expect(row.overridden).toBe(false);
      expect(row.value).toBe(row.builtin);
    }
  });

  it("an override produces a row reflecting the overridden value", () => {
    const rows = buildPaxRows(JSON.stringify({ CS: 0.9 }));
    const cs = rows.find((r) => r.code === "CS");
    expect(cs).toBeDefined();
    expect(cs!.value).toBe(0.9);
    expect(cs!.overridden).toBe(true);
    expect(serializePaxOverrides(rows)).toBe(JSON.stringify({ CS: 0.9 }));
  });

  it("a custom (non-builtin) code round-trips through build + serialize", () => {
    const rows = buildPaxRows(JSON.stringify({ ZZZ: 0.5 }));
    const zzz = rows.find((r) => r.code === "ZZZ");
    expect(zzz).toBeDefined();
    expect(zzz!.builtin).toBeNull();
    expect(zzz!.value).toBe(0.5);
    expect(zzz!.overridden).toBe(true);
    expect(serializePaxOverrides(rows)).toBe(JSON.stringify({ ZZZ: 0.5 }));
  });

  it("a stored override equal to the builtin value is not reported as overridden", () => {
    const builtinCs = RMSOLO_PAX_2026["CS"];
    expect(builtinCs).toBeDefined();
    const rows = buildPaxRows(JSON.stringify({ CS: builtinCs }));
    const cs = rows.find((r) => r.code === "CS");
    expect(cs).toBeDefined();
    expect(cs!.overridden).toBe(false);
  });

  it("editing a row's value back to its builtin drops it from serialization", () => {
    const rows = buildPaxRows(JSON.stringify({ CS: 0.9 }));
    const reverted = rows.map((r) =>
      r.code === "CS" ? { ...r, value: r.builtin!, overridden: false } : r,
    );
    expect(serializePaxOverrides(reverted)).toBe("{}");
  });
});

describe("canonicalPaxJson", () => {
  it("normalizes key order so semantically-equal tables compare equal", () => {
    const a = canonicalPaxJson(JSON.stringify({ CS: 0.9, AS: 0.83 }));
    const b = canonicalPaxJson(JSON.stringify({ AS: 0.83, CS: 0.9 }));
    expect(a).toBe(b);
  });

  it("differing content produces differing canonical output", () => {
    const a = canonicalPaxJson(JSON.stringify({ CS: 0.9 }));
    const b = canonicalPaxJson(JSON.stringify({ CS: 0.85 }));
    expect(a).not.toBe(b);
  });
});
