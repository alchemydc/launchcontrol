import { describe, expect, it } from "vitest";
import { canonicalPaxJson, rowsToTable, tableToRows } from "@/lib/pax-table-edit";

// Task R3: the ruleset editor now edits the FULL paxTable directly — no
// built-in/override distinction (that provisional semantics from Task R2 is
// gone, along with buildPaxRows/serializePaxOverrides). tableToRows/rowsToTable
// are a plain table<->rows mapping; canonicalPaxJson is unchanged.

describe("tableToRows", () => {
  it("an empty table produces no rows", () => {
    expect(tableToRows("{}")).toEqual([]);
  });

  it("every code in the table becomes a row, sorted by code", () => {
    const rows = tableToRows(JSON.stringify({ CS: 0.814, AS: 0.83 }));
    expect(rows).toEqual([
      { code: "AS", value: 0.83 },
      { code: "CS", value: 0.814 },
    ]);
  });

  it("a malformed table JSON produces no rows rather than throwing", () => {
    expect(tableToRows("not json")).toEqual([]);
  });

  it("drops an entry whose value isn't a finite number, keeping the rest", () => {
    const rows = tableToRows(JSON.stringify({ CS: 0.814, BAD: "0.9" }));
    expect(rows).toEqual([{ code: "CS", value: 0.814 }]);
  });
});

describe("rowsToTable", () => {
  it("an empty row list serializes to an empty object", () => {
    expect(rowsToTable([])).toBe("{}");
  });

  it("serializes rows to a code->factor object, key order sorted", () => {
    const json = rowsToTable([
      { code: "CS", value: 0.9 },
      { code: "AS", value: 0.83 },
    ]);
    expect(JSON.parse(json)).toEqual({ AS: 0.83, CS: 0.9 });
    // Sorted key order for stable diffs / equality with canonicalPaxJson.
    expect(json).toBe(JSON.stringify({ AS: 0.83, CS: 0.9 }));
  });

  it("round-trips through tableToRows for an arbitrary table, including a non-builtin code", () => {
    const original = JSON.stringify({ CS: 0.9, ZZZ: 0.5 });
    const rows = tableToRows(original);
    expect(canonicalPaxJson(rowsToTable(rows))).toBe(canonicalPaxJson(original));
  });

  it("a removed row is genuinely absent from the serialized table — no built-in resurrection", () => {
    // Simulates removing a builtin-covered code (e.g. "CS") from the editor:
    // rowsToTable must not re-add it from anywhere.
    const rows = tableToRows(JSON.stringify({ CS: 0.9, AS: 0.83 })).filter((r) => r.code !== "CS");
    const table = JSON.parse(rowsToTable(rows)) as Record<string, number>;
    expect(table).toEqual({ AS: 0.83 });
    expect(table).not.toHaveProperty("CS");
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
