import { parseSeasonPaxTable } from "@/lib/rmsolo-pax";

export type PaxRow = { code: string; value: number };

/**
 * COMPLETE ruleset paxTable JSON -> editable rows, sorted by code. Since
 * Task R3 the editor owns the FULL table (no built-in/override split) —
 * every row is just a code+factor pair the admin can edit, add, or remove.
 * Parsing is lenient (`parseSeasonPaxTable`): a malformed stored table
 * renders as no rows rather than crashing the editor, and an entry whose
 * value isn't a finite number is silently dropped.
 */
export function tableToRows(tableJson: string): PaxRow[] {
  const table = parseSeasonPaxTable(tableJson);
  return Object.entries(table)
    .map(([code, value]) => ({ code, value }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Rows -> a COMPLETE code->factor JSON object, sorted by code for stable
 * diffs. This is authoritative: a code missing from `rows` is genuinely
 * absent from the output — there is no built-in table to fall back on or
 * merge against (see scoring-system.ts's update semantics).
 */
export function rowsToTable(rows: PaxRow[]): string {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  const out: Record<string, number> = {};
  for (const r of sorted) out[r.code] = r.value;
  return JSON.stringify(out);
}

/**
 * Canonical form of a paxTable JSON string for equality comparison —
 * parses (lenient, via parseSeasonPaxTable) then re-serializes with keys
 * sorted, so two JSON strings that differ only in key order (e.g. the
 * stored value vs. this editor's sorted-row serialization) compare equal.
 */
export function canonicalPaxJson(raw: string): string {
  const table = parseSeasonPaxTable(raw);
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}
