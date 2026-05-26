import { RunDisposition } from "@/generated/prisma/client";
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

export function bestCorrectedMsForEntry(entry: EntryForBest): number | null {
  if (entry.bestCommittedRunNumber != null) {
    const committed = entry.runs.find((r) => r.runNumber === entry.bestCommittedRunNumber);
    if (committed?.rawTimeMs != null) {
      return committed.rawTimeMs + committed.cones * CONE_PENALTY_MS;
    }
    // Fall through if AxWare points at a run we didn't persist (shouldn't happen
    // post-M1.12 because status=3 runs always persist) or the run had no time.
  }
  const cleanCorrected = entry.runs
    .filter((r) => r.disposition === RunDisposition.CLEAN && r.rawTimeMs != null)
    .map((r) => (r.rawTimeMs as number) + r.cones * CONE_PENALTY_MS);
  return cleanCorrected.length > 0 ? Math.min(...cleanCorrected) : null;
}
