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

/** Virtual (non-class) event views, addressed by the same `[class]` route segment. */
export const RAW_VIEW = "raw";
export const PAX_VIEW = "pax";

export type EventView = {
  /** The rows this view renders — one class's, or every entry at the event. */
  rows: LeaderboardRow[];
  /** Heading suffix after the event name. */
  label: string;
  /** Rank and show gaps on the PAX-indexed metric rather than raw time. */
  paxView: boolean;
  /** Which nav pill is current: a class code, `"pax"`, or `"raw"`. */
  navActive: string;
};

/**
 * Resolve one event page's `[class]` segment to the view it addresses, or
 * `null` when it addresses nothing (→ 404).
 *
 * Three kinds of view share this one route segment:
 *   - a real class code — that class's rows only;
 *   - `"pax"` — every entry ranked on the indexed metric, when the ruleset
 *     enables PAX standings;
 *   - `"raw"` — every entry ranked on raw time.
 *
 * The raw view restores what the pre-#99 client-side filter chip labelled
 * "All Raw" (or plain "All" with PAX standings off). PR #99 replaced that chip
 * row with per-class routes and carried over Overview, All PAX, and the class
 * views, but nothing addressed the unfiltered list — so it became unreachable.
 * Unlike the PAX view it is deliberately NOT gated on `paxStandings`: the
 * unfiltered list is meaningful for every league, and with PAX standings off
 * it is simply labelled "All" in the nav.
 *
 * A REAL class is matched first, so a club that actually runs a class named
 * "RAW" or "PAX" gets its own class page rather than the virtual view — the
 * same precedence the season leaderboard gives a real class over its synthetic
 * PAX section (see PAX_SECTION_CODE in season-leaderboard.ts).
 */
export function resolveEventView(
  rows: LeaderboardRow[],
  classParam: string,
  paxStandings: boolean,
): EventView | null {
  const realClass = filterRowsForClass(rows, classParam);
  if (realClass != null) {
    return {
      rows: realClass.rows,
      label: realClass.classCode,
      paxView: classUsesPaxMetric(realClass.rows, paxStandings),
      navActive: realClass.classCode,
    };
  }

  const wanted = classParam.trim().toLowerCase();
  if (wanted === PAX_VIEW && paxStandings) {
    return { rows, label: "PAX standings", paxView: true, navActive: PAX_VIEW };
  }
  if (wanted === RAW_VIEW) {
    return { rows, label: "All raw times", paxView: false, navActive: RAW_VIEW };
  }
  return null;
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
