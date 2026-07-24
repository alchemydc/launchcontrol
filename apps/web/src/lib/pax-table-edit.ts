import { RMSOLO_PAX_2026, parseSeasonPaxTable } from "@/lib/rmsolo-pax";

export type PaxRow = { code: string; builtin: number | null; value: number; overridden: boolean };

/** Union of built-in 2026 codes and season overrides, sorted by code. */
export function buildPaxRows(overridesJson: string): PaxRow[] {
  const overrides = parseSeasonPaxTable(overridesJson);
  const codes = [...new Set([...Object.keys(RMSOLO_PAX_2026), ...Object.keys(overrides)])].sort();
  return codes.map((code) => {
    const builtin = RMSOLO_PAX_2026[code] ?? null;
    const value = overrides[code] ?? builtin ?? 1.0;
    return { code, builtin, value, overridden: overrides[code] != null };
  });
}

/** Only differences from the built-in table (plus custom codes) persist as overrides. */
export function serializePaxOverrides(rows: PaxRow[]): string {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.builtin === null || r.value !== r.builtin) out[r.code] = r.value;
  }
  return JSON.stringify(out);
}

/**
 * Canonical form of a Season.paxTable JSON string for equality comparison —
 * parses (lenient, via parseSeasonPaxTable) then re-serializes with keys
 * sorted, so two JSON strings that differ only in key order (e.g. the
 * stored value vs. this editor's sorted-row serialization) compare equal.
 */
export function canonicalPaxJson(raw: string): string {
  const table = parseSeasonPaxTable(raw);
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}
