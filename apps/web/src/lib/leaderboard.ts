import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { CONE_PENALTY_MS } from "@/lib/constants";

// Mirrors the Prisma enum but as a string-literal union so this module stays
// browser-safe (the client leaderboard component imports types from here).
export type RunDisposition = "CLEAN" | "DNF" | "RRN" | "OFF" | "DSQ";

type EntryWithRelations = {
  id: number;
  carNumber: string;
  carDescription: string | null;
  bestCommittedRunNumber: number | null;
  driver: { id: number; firstName: string; lastInitial: string };
  class: { code: string };
  paxClass: { code: string; paxIndex: { toString(): string } };
  runs: Array<{
    runNumber: number;
    rawTimeMs: number | null;
    cones: number;
    disposition: RunDisposition;
  }>;
};

export type LeaderboardRun = {
  runNumber: number;
  rawTimeMs: number | null;
  cones: number;
  disposition: RunDisposition;
  correctedMs: number | null;
};

export type LeaderboardRow = {
  driverId: number;
  driverName: string;
  carNumber: string;
  classCode: string;
  paxClassCode: string;
  paxIndex: number;
  carDescription: string | null;
  bestRawMs: number | null;
  bestPaxMs: number | null;
  runs: LeaderboardRun[];
};

export function buildLeaderboard(entries: EntryWithRelations[]): LeaderboardRow[] {
  const rows = entries.map((entry): LeaderboardRow => {
    const paxIndex = Number(entry.paxClass.paxIndex.toString());

    const runs: LeaderboardRun[] = entry.runs.map((r) => ({
      runNumber: r.runNumber,
      rawTimeMs: r.rawTimeMs,
      cones: r.cones,
      disposition: r.disposition,
      correctedMs:
        r.disposition === "CLEAN" && r.rawTimeMs != null
          ? r.rawTimeMs + r.cones * CONE_PENALTY_MS
          : null,
    }));

    const bestRawMs = bestCorrectedMsForEntry(entry);
    const bestPaxMs = bestRawMs == null ? null : Math.round(bestRawMs * paxIndex);

    return {
      driverId: entry.driver.id,
      driverName: `${entry.driver.firstName} ${entry.driver.lastInitial}`,
      carNumber: entry.carNumber,
      classCode: entry.class.code,
      paxClassCode: entry.paxClass.code,
      paxIndex,
      carDescription: entry.carDescription,
      bestRawMs,
      bestPaxMs,
      runs: runs.sort((a, b) => a.runNumber - b.runNumber),
    };
  });

  // Default sort: PAX best ascending, nulls last.
  return rows.sort((a, b) => {
    if (a.bestPaxMs == null && b.bestPaxMs == null) return 0;
    if (a.bestPaxMs == null) return 1;
    if (b.bestPaxMs == null) return -1;
    return a.bestPaxMs - b.bestPaxMs;
  });
}

export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return (ms / 1000).toFixed(3);
}
