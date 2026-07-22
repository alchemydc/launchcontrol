// M1.15 — combined (same-date, multi-session) event results.
//
// Builds the per-class + overall standings for a "combined event": two or
// more sessions (VisualAX `.axdb` exports, each ingested as its own `Event`)
// sharing a calendar date, scored on summed best-corrected time per the
// club's own AM/PM handout convention. See docs/BUILD.md M1.15 and
// season-leaderboard.ts (which applies the same forfeit rules for season
// points) for the design.
//
// Forfeit rules (mirrors season-leaderboard.ts): a driver only qualifies
// (appears "ranked", contributes a Time Sum) when they have a countable
// (CLEAN, per bestCorrectedMsForEntry) time in *every* session, *in the same
// class*. A missing session or a cross-session class mismatch excludes them
// — they still appear, unranked, with the session(s) they're missing so
// members can see why they earned no points.

import { CONE_PENALTY_MS } from "@/lib/constants";
import { bestCorrectedMsForEntry, type EntryForBest, type RunForBest } from "@/lib/entry-best";
import { combinedEventLabel } from "@/lib/season-leaderboard";
import { formatDriverName } from "@/lib/club-config";

export type CombinedEntry = EntryForBest & {
  carNumber: string;
  carDescription: string | null;
  driver: { id: number; firstName: string; lastInitial: string; lastName: string | null };
  class: { code: string };
};

export type CombinedSessionEvent = {
  id: number;
  slug: string;
  name: string;
  date: Date;
  entries: CombinedEntry[];
};

export type CombinedSessionResult = {
  eventId: number;
  eventSlug: string;
  eventName: string;
  runNumber: number | null; // which run produced correctedMs, for "R4: 38.335"-style display
  correctedMs: number | null; // null when the driver posted no countable time this session
};

export type CombinedResultRow = {
  driverId: number;
  driverName: string; // "First L." by default; "First Last" only when NAME_DISPLAY=full and lastName is stored
  classCode: string;
  carNumber: string;
  carDescription: string | null;
  sessions: CombinedSessionResult[]; // one per session, in the same order as CombinedResults.sessions
  sumMs: number | null; // null ⇒ unranked (forfeited)
  missingSessions: string[]; // session names with no countable time this row's class
  classMismatch: boolean; // true only in the overall section — driver ran a different class in different sessions
};

export type CombinedSection = {
  classCode: string | null; // null for the overall section
  ranked: CombinedResultRow[]; // sorted by sumMs asc
  unranked: CombinedResultRow[]; // sorted by driverName asc
};

export type CombinedResults = {
  sessions: Array<{ id: number; slug: string; name: string; date: Date }>;
  label: string;
  classes: CombinedSection[]; // sorted by classCode asc
  overall: CombinedSection;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// bestCorrectedMsForEntry() already resolves committed-vs-fallback-CLEAN; this
// just re-identifies *which* run produced that value so the UI can show
// "R4: 38.335" the way the club's own handout does. Reuses the same
// CONE_PENALTY_MS constant rather than re-deriving the cone math.
function bestRunForEntry(entry: EntryForBest): { runNumber: number | null; correctedMs: number } | null {
  const bestMs = bestCorrectedMsForEntry(entry);
  if (bestMs == null) return null;
  const match = entry.runs.find(
    (r: RunForBest) =>
      r.disposition === "CLEAN" && r.rawTimeMs != null && r.rawTimeMs + r.cones * CONE_PENALTY_MS === bestMs,
  );
  return { runNumber: match?.runNumber ?? entry.bestCommittedRunNumber ?? null, correctedMs: bestMs };
}

function sessionMeta(event: CombinedSessionEvent) {
  return { eventId: event.id, eventSlug: event.slug, eventName: event.name };
}

function sortRows(rows: CombinedResultRow[]): { ranked: CombinedResultRow[]; unranked: CombinedResultRow[] } {
  const ranked = rows
    .filter((r) => r.sumMs != null)
    .sort((a, b) => (a.sumMs as number) - (b.sumMs as number) || a.driverName.localeCompare(b.driverName));
  const unranked = rows
    .filter((r) => r.sumMs == null)
    .sort((a, b) => a.driverName.localeCompare(b.driverName));
  return { ranked, unranked };
}

function buildClassSection(events: CombinedSessionEvent[], classCode: string): CombinedSection {
  const driverIds = new Set<number>();
  for (const event of events) {
    for (const entry of event.entries) {
      if (entry.class.code === classCode) driverIds.add(entry.driver.id);
    }
  }

  const rows: CombinedResultRow[] = [];
  for (const driverId of driverIds) {
    let driverName = "";
    let carNumber = "";
    let carDescription: string | null = null;
    const sessions: CombinedSessionResult[] = [];

    for (const event of events) {
      const entry = event.entries.find((e) => e.driver.id === driverId && e.class.code === classCode);
      if (entry == null) {
        sessions.push({ ...sessionMeta(event), runNumber: null, correctedMs: null });
        continue;
      }
      if (driverName === "") {
        driverName = formatDriverName(entry.driver);
        carNumber = entry.carNumber;
        carDescription = entry.carDescription;
      }
      const best = bestRunForEntry(entry);
      sessions.push({ ...sessionMeta(event), runNumber: best?.runNumber ?? null, correctedMs: best?.correctedMs ?? null });
    }

    const missingSessions = sessions.filter((s) => s.correctedMs == null).map((s) => s.eventName);
    const sumMs = missingSessions.length === 0 ? sessions.reduce((sum, s) => sum + (s.correctedMs ?? 0), 0) : null;

    rows.push({
      driverId,
      driverName,
      classCode,
      carNumber,
      carDescription,
      sessions,
      sumMs,
      missingSessions,
      classMismatch: false,
    });
  }

  return { classCode, ...sortRows(rows) };
}

function buildOverallSection(events: CombinedSessionEvent[]): CombinedSection {
  const driverIds = new Set<number>();
  for (const event of events) {
    for (const entry of event.entries) driverIds.add(entry.driver.id);
  }

  const rows: CombinedResultRow[] = [];
  for (const driverId of driverIds) {
    let driverName = "";
    let carNumber = "";
    let carDescription: string | null = null;
    let primaryClass = "";
    let classMismatch = false;
    const sessions: CombinedSessionResult[] = [];

    for (const event of events) {
      // Defensive: the one-class-per-driver-per-event invariant means this
      // should never be >1, but pick the faster entry rather than throw if
      // it ever is (mirrors season-leaderboard.ts's per-event dedupe).
      const candidates = event.entries.filter((e) => e.driver.id === driverId);
      const chosen = candidates.reduce<CombinedEntry | null>((best, c) => {
        if (best == null) return c;
        const bestMs = bestCorrectedMsForEntry(best);
        const curMs = bestCorrectedMsForEntry(c);
        if (curMs == null) return best;
        if (bestMs == null || curMs < bestMs) return c;
        return best;
      }, null);

      if (chosen != null && driverName === "") {
        driverName = formatDriverName(chosen.driver);
        carNumber = chosen.carNumber;
        carDescription = chosen.carDescription;
      }

      if (chosen == null) {
        sessions.push({ ...sessionMeta(event), runNumber: null, correctedMs: null });
        continue;
      }

      if (primaryClass === "") primaryClass = chosen.class.code;
      else if (chosen.class.code !== primaryClass) classMismatch = true;

      const best = bestRunForEntry(chosen);
      sessions.push({ ...sessionMeta(event), runNumber: best?.runNumber ?? null, correctedMs: best?.correctedMs ?? null });
    }

    const missingSessions = sessions.filter((s) => s.correctedMs == null).map((s) => s.eventName);
    const sumMs =
      missingSessions.length === 0 && !classMismatch
        ? sessions.reduce((sum, s) => sum + (s.correctedMs ?? 0), 0)
        : null;

    rows.push({
      driverId,
      driverName,
      classCode: primaryClass,
      carNumber,
      carDescription,
      sessions,
      sumMs,
      missingSessions,
      classMismatch,
    });
  }

  return { classCode: null, ...sortRows(rows) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build combined (per-class + overall) standings for a set of same-date
 * session events. Callers (the /events/combined/[date] page) are responsible
 * for loading `events` with entries/runs/class/driver and for the >=2-events
 * guard — this function itself just orders sessions deterministically
 * (name ascending, so "(A)" sorts before "(B)" even if a session was
 * deleted and re-ingested out of order; `id` breaks exact-name ties) and
 * computes results.
 */
export function buildCombinedResults(events: CombinedSessionEvent[]): CombinedResults {
  const ordered = [...events].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  const classCodes = Array.from(
    new Set(ordered.flatMap((e) => e.entries.map((entry) => entry.class.code))),
  ).sort();

  return {
    sessions: ordered.map((e) => ({ id: e.id, slug: e.slug, name: e.name, date: e.date })),
    label: combinedEventLabel(ordered),
    classes: classCodes.map((code) => buildClassSection(ordered, code)),
    overall: buildOverallSection(ordered),
  };
}
