import type { RunDisposition } from "@/generated/prisma/client";
import { CONE_PENALTY_MS } from "@/lib/constants";

export type RunForBest = {
  runNumber: number;
  rawTimeMs: number | null;
  cones: number;
  disposition: RunDisposition;
};

export type EntryForBest = {
  bestCommittedRunNumber: number | null;
  runs: RunForBest[];
};

/**
 * `penaltyMs` (League Foundation PR 2 Task 7): milliseconds added per cone
 * struck, defaulting to the shared `CONE_PENALTY_MS` constant so every
 * pre-existing call site is unchanged (parity). Callers scoring a season pass
 * that season's `scoringPolicy.conePenaltyMs` (see season-leaderboard.ts,
 * leaderboard.ts, combined-event.ts) instead of relying on the constant.
 */
export function bestCorrectedMsForEntry(
  entry: EntryForBest,
  penaltyMs: number = CONE_PENALTY_MS,
): number | null {
  if (entry.bestCommittedRunNumber != null) {
    const committed = entry.runs.find((r) => r.runNumber === entry.bestCommittedRunNumber);
    if (committed?.disposition === "CLEAN" && committed.rawTimeMs != null) {
      return committed.rawTimeMs + committed.cones * penaltyMs;
    }
    // Fall through if VisualAX points at a non-CLEAN run (data anomaly — DSQ/RRN/
    // DNF/OFF should never be committed-best per club policy), at a run we didn't
    // persist, or at a run without rawTimeMs.
  }
  const cleanCorrected = entry.runs
    .filter((r) => r.disposition === "CLEAN" && r.rawTimeMs != null)
    .map((r) => (r.rawTimeMs as number) + r.cones * penaltyMs);
  return cleanCorrected.length > 0 ? Math.min(...cleanCorrected) : null;
}
