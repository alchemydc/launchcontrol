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
};

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
