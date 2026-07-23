/**
 * 2026 PAX/RTP factors as applied by Rocky Mountain Solo.
 *
 * Source of truth: RMsolo's own per-event Index PDF, which lists each
 * driver's class and the applied index factor (including the club-local
 * "*T" street-tire classes, which are the same STR/STU/STX/STH/STS codes
 * SCCA's own PAX table uses under their national names):
 *   https://www.rmsolo.org/wp-content/uploads/2026/05/ss2-0426_index-7.pdf
 *   ("Summer 2026#2" event, Indexed Results, downloaded 2026-07-22)
 *
 * Every value below was independently cross-checked against the published
 * 2026 SCCA PAX/RTP table:
 *   https://www.solotime.info/pax/  (fetched 2026-07-22)
 * All classes agreed exactly between the two sources — no discrepancies to
 * resolve.
 *
 * The Index PDF is authoritative for what RMsolo actually applies, so this
 * table includes every class code that appears with a real factor in the
 * PDF — including the Xtreme classes (XA/XB/XU) and Modified/Prepared
 * classes (FS/FSP/FP/FM/SMF/SSM) that only ever ran with a run-group
 * prefix (X/, N/, S/, P/, M/) in this event but carry the same factor as
 * their base class. Only grouping codes that never appear in the Index PDF
 * at all (e.g. bare "N" or "M" with no class suffix) are truly unlisted and
 * fall back to 1.0 via getRmsoloPaxIndex.
 */
export const RMSOLO_PAX_2026: Record<string, number> = {
  SS: 0.840,
  AS: 0.830,
  BS: 0.823,
  CS: 0.814,
  DS: 0.811,
  ES: 0.788,
  FS: 0.817,
  GS: 0.809,
  HS: 0.780,
  SSC: 0.808,
  AST: 0.836,
  BST: 0.835,
  CST: 0.829,
  DST: 0.820,
  GST: 0.812,
  SST: 0.838,
  CAMC: 0.828,
  CAMS: 0.847,
  CAMT: 0.819,
  XA: 0.861,
  XB: 0.859,
  XU: 0.872,
  FSP: 0.833,
  FP: 0.877,
  FM: 0.917,
  SMF: 0.857,
  SSM: 0.878,
  BM: 0.966,
  // Added 2026-07-22 from the club's "RmSolo 2026 Unofficial Season Points"
  // sheet (Index column, events SS1-SS5) — classes the club scores that had
  // not yet appeared in the sampled Index PDF. Cross-checked against the
  // 2026 SCCA PAX table where applicable; AM is the PAX baseline (1.000).
  AM: 1.0,
  CP: 0.862,
  CSP: 0.858,
  CSX: 0.803,
  DM: 0.906,
  EP: 0.865,
  EST: 0.815,
};

/**
 * Match a factor derived from a results PDF (printed indexed Best ÷ best
 * penalized raw time) to the class whose PAX index it came from.
 *
 * Run-group sections (M/N/S/P/X) in RMsolo Full PDFs never print a driver's
 * underlying class, but they do print a PAX-indexed Best — so the applied
 * factor is recoverable to ~5 decimal places, far tighter than the ~0.002
 * spacing between adjacent PAX values. Returns null when nothing in the
 * table is within `tolerance` (e.g. a factor from a class we don't know).
 */
export function nearestPaxClass(
  derivedFactor: number,
  tolerance = 0.003,
): { code: string; pax: number } | null {
  let best: { code: string; pax: number } | null = null;
  let bestDiff = Infinity;
  for (const [code, pax] of Object.entries(RMSOLO_PAX_2026)) {
    const diff = Math.abs(pax - derivedFactor);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { code, pax };
    }
  }
  return bestDiff <= tolerance ? best : null;
}

const warned = new Set<string>();

export function getRmsoloPaxIndex(classCode: string): number {
  const pax = RMSOLO_PAX_2026[classCode];
  if (pax != null) return pax;
  if (!warned.has(classCode)) {
    warned.add(classCode);
    console.warn(`[rmsolo-pax] no PAX factor for class '${classCode}' — using 1.0`);
  }
  return 1.0;
}

/**
 * Parses a Season.paxTable JSON string (see schema.prisma) into a plain
 * code->factor map. Returns `{}` (and warns once) for anything that isn't a
 * JSON object — a malformed table must not crash an ingest, just fall
 * through to the built-in table for every class code. Per-entry values are
 * validated too: an entry whose value isn't a finite number is dropped (with
 * a warning), not coerced — a numeric STRING like `"0.83"` is dropped rather
 * than parsed, so a class with a dropped/invalid entry falls through to
 * `getRmsoloPaxIndex`'s built-in table exactly like a class missing from the
 * paxTable altogether, instead of silently taking on a value of the wrong type.
 */
export function parseSeasonPaxTable(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const table: Record<string, number> = {};
      for (const [classCode, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          table[classCode] = value;
        } else {
          console.warn(
            `[rmsolo-pax] season paxTable entry '${classCode}' is not a finite number — ignoring it: ${JSON.stringify(value)}`,
          );
        }
      }
      return table;
    }
  } catch {
    // fall through to the warning below
  }
  console.warn(`[rmsolo-pax] season paxTable is not a valid JSON object — ignoring it: ${JSON.stringify(raw)}`);
  return {};
}

/**
 * PAX index precedence for a class code during RMsolo ingest (see
 * docs/superpowers/specs/2026-07-23-league-multiclub-design.md "paxTable
 * precedence"): the season's own paxTable overrides the built-in 2026 table,
 * which itself falls back to 1.0 (with a warning) for an unknown class.
 * Run-group factor DERIVATION (nearestPaxClass, matching a printed indexed
 * Best back to a class code) is unrelated and unchanged by this — this
 * function only resolves the final numeric factor for a class code once
 * that code is already known.
 */
export function resolveSeasonPaxIndex(classCode: string, seasonPaxTable: Record<string, number>): number {
  const override = seasonPaxTable[classCode];
  return override != null ? override : getRmsoloPaxIndex(classCode);
}
