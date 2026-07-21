import type { PrismaClient } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { prisma } from "@/lib/prisma";
import { combinedEventLabel } from "@/lib/season-leaderboard";

export type DriverHistoryRow = {
  eventId: number;
  eventSlug: string;
  eventName: string;
  eventDate: Date;
  classCode: string;
  paxClassCode: string;
  carNumber: string;
  bestRawMs: number | null;
  bestPaxMs: number | null;
  leaderPaxMs: number | null;
  entrantCount: number;
  position: number | null;
  percentile: number | null;
  diffFromLeaderPct: number | null;
  medianPaxMs: number | null;
  diffFromMedianPct: number | null;
  href: string; // `/events/[slug]` (single event) or `/events/combined/[date]` (M1.17)
  combined: boolean; // true when this row collapses a same-date multi-session group (M1.17)
};

export type EntryForHistory = {
  id: number;
  driverId: number;
  carNumber: string;
  bestCommittedRunNumber: number | null;
  class: { code: string };
  paxClass: { code: string; paxIndex: { toString(): string } };
  runs: Array<{
    runNumber: number;
    rawTimeMs: number | null;
    cones: number;
    disposition: "CLEAN" | "DNF" | "RRN" | "OFF" | "DSQ";
  }>;
};

export function bestPaxMsForEntry(entry: EntryForHistory): {
  bestRawMs: number | null;
  bestPaxMs: number | null;
} {
  const bestRawMs = bestCorrectedMsForEntry(entry);
  if (bestRawMs == null) return { bestRawMs: null, bestPaxMs: null };
  const paxIndex = Number(entry.paxClass.paxIndex.toString());
  return { bestRawMs, bestPaxMs: Math.round(bestRawMs * paxIndex) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Median over PAX times already sorted ascending. Class-agnostic (pooled),
// shared by both the single-event and combined-event row builders below.
function medianOf(sortedAscMs: number[]): number | null {
  const n = sortedAscMs.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sortedAscMs[(n - 1) / 2] as number;
  return Math.round(
    ((sortedAscMs[n / 2 - 1] as number) + (sortedAscMs[n / 2] as number)) / 2,
  );
}

// Fetch every session (Event + full entries/runs/class/paxClass) whose date
// is one of `dates` -- NOT filtered by driverId, so a same-date combined
// group's full sibling-session and entrant pool resolves even when the
// subject driver only entered one of its sessions (see buildCombinedHistoryRow).
function loadEventsForDates(prismaClient: PrismaClient, dates: Date[]) {
  return prismaClient.event.findMany({
    where: { date: { in: dates } },
    orderBy: { date: "asc" },
    include: {
      entries: {
        include: {
          class: { select: { code: true } },
          paxClass: { select: { code: true, paxIndex: true } },
          runs: {
            select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true },
          },
        },
      },
    },
  });
}

type LoadedEvent = Awaited<ReturnType<typeof loadEventsForDates>>[number];

/**
 * Build the driver-history row for one single (non-combined) event -- the
 * pre-M1.17 per-event math, unchanged. `ranked` pools ALL entrants at the
 * event regardless of class (this page is class-agnostic pooled-PAX, unlike
 * the per-class season leaderboard).
 */
function buildSingleEventRow(event: LoadedEvent, driverId: number): DriverHistoryRow {
  const ranked = event.entries
    .map((e) => ({ entry: e, ...bestPaxMsForEntry(e) }))
    .filter((r): r is typeof r & { bestPaxMs: number } => r.bestPaxMs != null)
    .sort((a, b) => a.bestPaxMs - b.bestPaxMs);

  const leaderPaxMs = ranked[0]?.bestPaxMs ?? null;

  // Median PAX time across all entrants with a clean run at this event.
  const medianPaxMs = medianOf(ranked.map((r) => r.bestPaxMs));

  // A driver may have multiple entries at one event (co-drive); pick their best.
  const driverRanked = ranked.filter((r) => r.entry.driverId === driverId);
  const best = driverRanked[0];
  const position =
    best == null ? null : ranked.findIndex((r) => r.entry.id === best.entry.id) + 1;

  // The "display" entry is the driver's best-PAX entry if they had a clean run,
  // otherwise just the first entry we have for them at this event.
  const displayEntry =
    best?.entry ?? event.entries.find((e) => e.driverId === driverId)!;

  const bestRawMs = best?.bestRawMs ?? null;
  const bestPaxMs = best?.bestPaxMs ?? null;

  const diffFromLeaderPct =
    bestPaxMs == null || leaderPaxMs == null || leaderPaxMs === 0
      ? null
      : (bestPaxMs - leaderPaxMs) / leaderPaxMs;

  const diffFromMedianPct =
    bestPaxMs == null || medianPaxMs == null || medianPaxMs === 0
      ? null
      : (bestPaxMs - medianPaxMs) / medianPaxMs;

  return {
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    eventDate: event.date,
    classCode: displayEntry.class.code,
    paxClassCode: displayEntry.paxClass.code,
    carNumber: displayEntry.carNumber,
    bestRawMs,
    bestPaxMs,
    leaderPaxMs,
    entrantCount: ranked.length,
    position,
    percentile:
      position == null || ranked.length === 0 ? null : position / ranked.length,
    diffFromLeaderPct,
    medianPaxMs,
    diffFromMedianPct,
    href: `/events/${event.slug}`,
    combined: false,
  };
}

/**
 * Collapse a same-date group of >=2 sessions (M1.15 "combined event") into
 * ONE driver-history row, ranked by pooled PAX time SUMMED across every
 * session in the group -- consistent with the rest of this page, which is
 * pooled-PAX and class-agnostic (see `buildSingleEventRow`'s `ranked`). This
 * intentionally can differ from `/events/combined/[date]`
 * (season-leaderboard.ts, combined-event.ts), which ranks by summed RAW time
 * WITHIN each class -- the same divergence that already exists between this
 * page and the season leaderboard for single events.
 *
 * Forfeit rule mirrors combined-event.ts / season-leaderboard.ts: a driver
 * only qualifies (contributes a summed time to the ranked pool) when they
 * have a countable best in EVERY session of the group, IN THE SAME CLASS. A
 * missing session or a cross-session class mismatch excludes them from the
 * ranked pool entirely -- the row is still rendered, just with null
 * bestPaxMs/position/percentile, the same way today's DNF-only single-event
 * rows are kept rather than dropped.
 */
function buildCombinedHistoryRow(
  sessionsInput: LoadedEvent[],
  driverId: number,
): DriverHistoryRow {
  // Deterministic session order regardless of how same-date ties came back
  // from the DB (mirrors combined-event.ts's own explicit session ordering).
  const sessions = [...sessionsInput].sort((a, b) => a.id - b.id);
  const dateKey = sessions[0]!.date.toISOString().slice(0, 10);

  // Per-session, per-driver best PAX (fastest entry per session -- co-drive
  // safe, mirrors buildSingleEventRow / combined-event.ts's own dedupe).
  const bestBySessionByDriver = sessions.map((session) => {
    const byDriver = new Map<
      number,
      { bestRawMs: number; bestPaxMs: number; classCode: string }
    >();
    for (const entry of session.entries) {
      const { bestRawMs, bestPaxMs } = bestPaxMsForEntry(entry);
      if (bestRawMs == null || bestPaxMs == null) continue;
      const existing = byDriver.get(entry.driverId);
      if (existing == null || bestPaxMs < existing.bestPaxMs) {
        byDriver.set(entry.driverId, { bestRawMs, bestPaxMs, classCode: entry.class.code });
      }
    }
    return byDriver;
  });

  // Union of every driver appearing in any session of the group.
  const allDriverIds = new Set<number>();
  for (const byDriver of bestBySessionByDriver) {
    for (const id of byDriver.keys()) allDriverIds.add(id);
  }

  // Qualify: a countable best in EVERY session, in the SAME class throughout.
  const qualifiers: Array<{ driverId: number; summedPax: number; summedRaw: number }> = [];
  for (const id of allDriverIds) {
    let summedPax = 0;
    let summedRaw = 0;
    let classCode: string | null = null;
    let qualifies = true;
    for (const byDriver of bestBySessionByDriver) {
      const sessBest = byDriver.get(id);
      if (sessBest == null) {
        qualifies = false;
        break;
      }
      if (classCode == null) classCode = sessBest.classCode;
      else if (sessBest.classCode !== classCode) {
        qualifies = false;
        break;
      }
      summedPax += sessBest.bestPaxMs;
      summedRaw += sessBest.bestRawMs;
    }
    if (qualifies) qualifiers.push({ driverId: id, summedPax, summedRaw });
  }

  const ranked = qualifiers.sort((a, b) => a.summedPax - b.summedPax);
  const leaderPaxMs = ranked[0]?.summedPax ?? null;
  const medianPaxMs = medianOf(ranked.map((r) => r.summedPax));

  const subjectIdx = ranked.findIndex((r) => r.driverId === driverId);
  const subject = subjectIdx === -1 ? null : ranked[subjectIdx];
  const position = subject == null ? null : subjectIdx + 1;

  const bestPaxMs = subject?.summedPax ?? null;
  const bestRawMs = subject?.summedRaw ?? null;

  const diffFromLeaderPct =
    bestPaxMs == null || leaderPaxMs == null || leaderPaxMs === 0
      ? null
      : (bestPaxMs - leaderPaxMs) / leaderPaxMs;

  const diffFromMedianPct =
    bestPaxMs == null || medianPaxMs == null || medianPaxMs === 0
      ? null
      : (bestPaxMs - medianPaxMs) / medianPaxMs;

  // Display fields come from whichever session (earliest by id) the subject
  // has an entry in -- guaranteed to exist in at least one session, since
  // buildDriverHistory only ever forms a group for a date the driver appears
  // on somewhere.
  const displayEntry = sessions.flatMap((s) => s.entries).find((e) => e.driverId === driverId)!;

  return {
    eventId: Math.min(...sessions.map((s) => s.id)),
    eventSlug: sessions[0]!.slug,
    eventName: combinedEventLabel(sessions),
    eventDate: sessions[0]!.date,
    classCode: displayEntry.class.code,
    paxClassCode: displayEntry.paxClass.code,
    carNumber: displayEntry.carNumber,
    bestRawMs,
    bestPaxMs,
    leaderPaxMs,
    entrantCount: ranked.length,
    position,
    percentile:
      position == null || ranked.length === 0 ? null : position / ranked.length,
    diffFromLeaderPct,
    medianPaxMs,
    diffFromMedianPct,
    href: `/events/combined/${dateKey}`,
    combined: true,
  };
}

/**
 * Build the full driver-history row set for one driver, in strict
 * chronological order.
 *
 * M1.17: events sharing a calendar date (a "combined event", M1.15) collapse
 * into ONE row via `buildCombinedHistoryRow` instead of appearing as
 * independent per-session rows. Discovering group membership requires a
 * second, driver-unfiltered query -- the initial per-driver query only
 * returns events this driver personally entered, which would miss a sibling
 * session they skipped (the forfeit case) and so under-detect the group.
 */
export async function buildDriverHistory(
  driverId: number,
  prismaClient: PrismaClient = prisma,
): Promise<DriverHistoryRow[]> {
  const driverEventDates = await prismaClient.event.findMany({
    where: { entries: { some: { driverId } } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (driverEventDates.length === 0) return [];

  // De-duplicated list of every calendar date the driver has any entry on.
  const dates = Array.from(new Set(driverEventDates.map((d) => d.date.getTime()))).map(
    (t) => new Date(t),
  );

  // Re-fetch every session sharing one of those dates -- not filtered by
  // driverId -- so a combined-event group resolves with its full sibling
  // session(s) and entrant pool even when this driver only entered one
  // session of the group.
  const events = await loadEventsForDates(prismaClient, dates);

  // Group by UTC date key -- the same key used in season-leaderboard.ts and
  // the combined event page. `events` is already date-ascending, so Map
  // insertion order preserves chronological group order.
  const groupsByDateKey = new Map<string, LoadedEvent[]>();
  for (const event of events) {
    const dateKey = event.date.toISOString().slice(0, 10);
    let group = groupsByDateKey.get(dateKey);
    if (group == null) {
      group = [];
      groupsByDateKey.set(dateKey, group);
    }
    group.push(event);
  }

  return Array.from(groupsByDateKey.values()).map((group) =>
    group.length === 1
      ? buildSingleEventRow(group[0]!, driverId)
      : buildCombinedHistoryRow(group, driverId),
  );
}
