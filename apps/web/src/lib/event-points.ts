import type { PointsSystem } from "@/lib/scoring-policy";

/**
 * Award one scoring group's points from a "lower is better" metric map
 * (driverId -> indexed best time in ms; fractional, since the indexed metric
 * is kept at full precision until points are computed).
 *
 * `points.basis` is deliberately NOT read here. The caller decides which
 * population a driver is scored against by choosing which map to pass — one
 * class section's map for basis "class", the event-wide map for basis "event"
 * — so both bases share this one implementation and this stays a pure
 * function of (population, system).
 */
export function awardPoints(
  metrics: ReadonlyMap<number, number>,
  points: PointsSystem,
): Map<number, number> {
  const awarded = new Map<number, number>();
  if (metrics.size === 0) return awarded;

  if (points.type === "ratio1000") {
    const fastest = Math.min(...metrics.values());
    for (const [driverId, metric] of metrics) {
      awarded.set(driverId, Math.round((1000 * fastest) / metric));
    }
    return awarded;
  }

  // Rank ascending on whole indexed milliseconds. Rounding to the millisecond
  // is the tie key, not the scoring value: two drivers with the same time tie
  // regardless of float representation noise in the indexed product.
  const ranked = Array.from(metrics, ([driverId, metric]) => ({
    driverId,
    tieKey: Math.round(metric),
  })).sort((a, b) => a.tieKey - b.tieKey);

  // Competition ranking: tied drivers all take the highest position they
  // cover, and the positions they consume are skipped (1st, 1st, 3rd).
  let position = 1;
  let runStart = 1;
  let previousTieKey: number | null = null;
  for (const { driverId, tieKey } of ranked) {
    if (previousTieKey === null || tieKey !== previousTieKey) {
      runStart = position;
      previousTieKey = tieKey;
    }
    awarded.set(driverId, points.table[runStart - 1] ?? points.beyondTable);
    position += 1;
  }
  return awarded;
}
