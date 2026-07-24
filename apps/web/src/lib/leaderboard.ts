import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { CONE_PENALTY_MS } from "@/lib/constants";
import { formatDriverName } from "@/lib/club-config";

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
      driverName: formatDriverName(entry.driver),
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

// ---------------------------------------------------------------------------
// Per-class page derivations — the event overview and one-class-per-page
// routes derive their views from buildLeaderboard's rows (no extra queries).
// ---------------------------------------------------------------------------

/**
 * Whether a class ranks on the PAX-indexed metric: PAX standings enabled and
 * heterogeneous per-entry factors (run-group classes M/N/S/P/X, whose printed
 * results are indexed). Uniform classes keep raw — identical order either way.
 * Moved here from the event leaderboard table so server routes share the rule.
 */
export function classUsesPaxMetric(
  rows: LeaderboardRow[],
  paxStandings: boolean,
): boolean {
  if (!paxStandings) return false;
  return new Set(rows.map((r) => r.paxIndex)).size > 1;
}

export type EventClassSummary = {
  classCode: string;
  entryCount: number;
  winner: { driverId: number; driverName: string; bestRawMs: number | null } | null;
};

/**
 * Overview rows for `/events/[slug]`: one entry per class, alphabetical.
 * The winner is ranked by the class's official metric (PAX-indexed for
 * heterogeneous run-group classes under PAX standings, raw otherwise) but
 * reports their raw best for display. Classes with no scored entry get a
 * null winner.
 */
export function summarizeEventClasses(
  rows: LeaderboardRow[],
  paxStandings: boolean,
): EventClassSummary[] {
  const byClass = new Map<string, LeaderboardRow[]>();
  for (const row of rows) {
    let bucket = byClass.get(row.classCode);
    if (bucket == null) {
      bucket = [];
      byClass.set(row.classCode, bucket);
    }
    bucket.push(row);
  }

  return Array.from(byClass.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classCode, classRows]) => {
      const paxMetric = classUsesPaxMetric(classRows, paxStandings);
      const metric = (r: LeaderboardRow) => (paxMetric ? r.bestPaxMs : r.bestRawMs);
      let winner: LeaderboardRow | null = null;
      for (const r of classRows) {
        const m = metric(r);
        if (m == null) continue;
        if (winner == null || m < metric(winner)!) winner = r;
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

/**
 * Resolve a `[class]` URL segment to its rows. Case-insensitive; returns the
 * canonical class code from the data plus only that class's rows, or null
 * (→ 404) when nothing matches.
 */
export function filterRowsForClass(
  rows: LeaderboardRow[],
  classParam: string,
): { classCode: string; rows: LeaderboardRow[] } | null {
  const wanted = classParam.trim().toLowerCase();
  if (wanted.length === 0) return null;
  const matched = rows.filter((r) => r.classCode.toLowerCase() === wanted);
  const first = matched[0];
  if (first == null) return null;
  return { classCode: first.classCode, rows: matched };
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
