/**
 * Scoring reads (PR 3, Task 10): resolve the PAX factor to actually score an
 * entry with. Prefers the `Entry.paxIndexApplied` snapshot stamped at ingest
 * (Tasks 8-9) — a frozen copy of the factor that was live at the time — over
 * the live `entry.paxClass.paxIndex` join, so editing a `CarClass.paxIndex`
 * later (a rules-committee correction, a new season's table, etc.) never
 * reaches back and changes an already-scored entry's numbers.
 *
 * Falls back to the live join only for rows ingested before the snapshot
 * column existed and not yet backfilled (Task 8's migration backfills every
 * pre-existing row, so in practice this warns only on a data anomaly).
 */
export function appliedPaxIndex(entry: {
  paxIndexApplied: unknown;
  paxClass: { paxIndex: unknown };
}): number {
  if (entry.paxIndexApplied != null) return Number(entry.paxIndexApplied);
  console.warn("Entry missing paxIndexApplied — falling back to live paxClass.paxIndex");
  return Number(entry.paxClass.paxIndex);
}
