import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { CONE_PENALTY_MS } from "@/lib/constants";
import { appliedPaxIndex } from "@/lib/pax-applied";

// Mirrors the Prisma enum but as a string-literal union so this module stays
// browser-safe (the client leaderboard component imports types from here).
export type RunDisposition = "CLEAN" | "DNF" | "RRN" | "OFF" | "DSQ";

type EntryWithRelations = {
  id: number;
  carNumber: string;
  carDescription: string | null;
  bestCommittedRunNumber: number | null;
  paxIndexApplied: unknown;
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

/**
 * `penaltyMs` (League Foundation PR 2 Task 7): defaults to the shared
 * `CONE_PENALTY_MS` constant, so existing call sites are unchanged (parity).
 * Event pages pass their event's assigned ruleset `policy.conePenaltyMs`.
 */
export function buildLeaderboard(
  entries: EntryWithRelations[],
  penaltyMs: number = CONE_PENALTY_MS,
): LeaderboardRow[] {
  const rows = entries.map((entry): LeaderboardRow => {
    const paxIndex = appliedPaxIndex(entry);

    const runs: LeaderboardRun[] = entry.runs.map((r) => ({
      runNumber: r.runNumber,
      rawTimeMs: r.rawTimeMs,
      cones: r.cones,
      disposition: r.disposition,
      correctedMs:
        r.disposition === "CLEAN" && r.rawTimeMs != null
          ? r.rawTimeMs + r.cones * penaltyMs
          : null,
    }));

    const bestRawMs = bestCorrectedMsForEntry(entry, penaltyMs);
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

export function classUsesPaxMetric(
  rows: LeaderboardRow[],
  paxStandings: boolean,
): boolean {
  if (!paxStandings) return false;
  return new Set(rows.map((row) => row.paxIndex)).size > 1;
}

export type EventClassSummary = {
  classCode: string;
  entryCount: number;
  winner: { driverId: number; driverName: string; bestRawMs: number | null } | null;
};

/**
 * Build one summary per class in alphabetical order. A heterogeneous
 * run-group class is ranked by its official PAX metric when PAX standings
 * are enabled; ordinary classes use raw corrected time.
 */
export function summarizeEventClasses(
  rows: LeaderboardRow[],
  paxStandings: boolean,
): EventClassSummary[] {
  const rowsByClass = new Map<string, LeaderboardRow[]>();
  for (const row of rows) {
    const classRows = rowsByClass.get(row.classCode);
    if (classRows == null) rowsByClass.set(row.classCode, [row]);
    else classRows.push(row);
  }

  return Array.from(rowsByClass.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classCode, classRows]) => {
      const usesPax = classUsesPaxMetric(classRows, paxStandings);
      const metric = (row: LeaderboardRow) =>
        usesPax ? row.bestPaxMs : row.bestRawMs;
      let winner: LeaderboardRow | null = null;

      for (const row of classRows) {
        const result = metric(row);
        if (result == null) continue;
        if (winner == null || result < metric(winner)!) winner = row;
      }

      return {
        classCode,
        entryCount: classRows.length,
        winner:
          winner == null
            ? null
            : {
                driverId: winner.driverId,
                driverName: winner.driverName,
                bestRawMs: winner.bestRawMs,
              },
      };
    });
}

export function filterRowsForClass(
  rows: LeaderboardRow[],
  classParam: string,
): { classCode: string; rows: LeaderboardRow[] } | null {
  const wanted = classParam.trim().toLowerCase();
  if (wanted.length === 0) return null;

  const matchingRows = rows.filter(
    (row) => row.classCode.toLowerCase() === wanted,
  );
  const first = matchingRows[0];
  return first == null
    ? null
    : { classCode: first.classCode, rows: matchingRows };
}

export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return (ms / 1000).toFixed(3);
}

// "+1.234" for a positive gap, "—" for null (leader / no time).
export function formatDelta(ms: number | null): string {
  if (ms == null) return "—";
  return "+" + (ms / 1000).toFixed(3);
}
