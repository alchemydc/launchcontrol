import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { resolveDefaultLeague } from "@/lib/league-config";
import { appliedPaxIndex } from "@/lib/pax-applied";
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
  leagueId: number; // Task 6: driver is global; every row carries its league so callers can
  leagueSlug: string; // aggregate counts/positions across leagues while keeping time-series
  leagueName: string; // charts split into one series per league (never mixed on one axis).
};

/**
 * Task 6 driver-stats filter. `leagueIds`/`seasonId` are mutually exclusive
 * scoping modes (a season pins exactly one league already); `seasonId` wins
 * if both are given. Omitting `leagueIds` entirely (the legacy call shape)
 * scopes to the deployment's default league, all time -- this is also the
 * Task-4-flagged carry-forward fix: `buildDriverHistory(driverId)` used to
 * query events completely unscoped by league, which was latent-safe on a
 * single-league DB but would silently blend another league's events into a
 * cross-league driver's history once a second league exists. Passing no
 * filter now makes that default-league scoping explicit rather than absent.
 */
export type DriverHistoryFilter = {
  leagueIds?: number[] | "all";
  seasonId?: number;
  from?: Date;
  to?: Date;
};

export type EntryForHistory = {
  id: number;
  driverId: number;
  carNumber: string;
  bestCommittedRunNumber: number | null;
  paxIndexApplied: unknown;
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
  const paxIndex = appliedPaxIndex(entry);
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
//
// `scopeWhere` (the same league/season fragment applied to the driver-date
// discovery query in `buildDriverHistory`) is applied here too -- without
// it, a coincidental same-date event in a DIFFERENT league (impossible
// pre-multi-league, now merely unlikely) would be fetched, and a driver with
// no entry in it would make `buildSingleEventRow`'s displayEntry lookup
// blow up. The date-range half of the filter is deliberately NOT re-applied
// here: `dates` was already derived from the range-filtered discovery query,
// and every sibling shares one of those exact dates by definition.
function loadEventsForDates(
  prismaClient: PrismaClient,
  dates: Date[],
  scopeWhere: Prisma.EventWhereInput,
) {
  return prismaClient.event.findMany({
    where: { date: { in: dates }, ...scopeWhere },
    orderBy: { date: "asc" },
    include: {
      season: { select: { leagueId: true, league: { select: { slug: true, name: true } } } },
      entries: {
        select: {
          id: true,
          driverId: true,
          carNumber: true,
          bestCommittedRunNumber: true,
          paxIndexApplied: true,
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
    leagueId: event.season.leagueId,
    leagueSlug: event.season.league.slug,
    leagueName: event.season.league.name,
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
    // All sessions in a group necessarily share one league -- buildDriverHistory's
    // (leagueId, dateKey) grouping key guarantees it, so sessions[0] speaks for the group.
    leagueId: sessions[0]!.season.leagueId,
    leagueSlug: sessions[0]!.season.league.slug,
    leagueName: sessions[0]!.season.league.name,
  };
}

// A resolved, unambiguous scoping mode -- the three DriverHistoryFilter
// shapes (explicit leagueIds, "all", or the implicit default-league legacy
// call) collapse to one of these before any query runs.
type ResolvedScope =
  | { kind: "season"; seasonId: number }
  | { kind: "leagues"; leagueIds: number[] }
  | { kind: "all" };

async function resolveScope(
  filter: DriverHistoryFilter,
  client: PrismaClient,
): Promise<ResolvedScope | null> {
  if (filter.seasonId != null) return { kind: "season", seasonId: filter.seasonId };
  if (filter.leagueIds === "all") return { kind: "all" };
  if (Array.isArray(filter.leagueIds)) return { kind: "leagues", leagueIds: filter.leagueIds };

  // No league filter given at all -- the legacy call shape. Scope to the
  // deployment's default league (see DriverHistoryFilter's doc comment).
  const defaultLeague = await resolveDefaultLeague(client);
  if (!defaultLeague) return null;
  return { kind: "leagues", leagueIds: [defaultLeague.id] };
}

function scopeWhereClause(scope: ResolvedScope): Prisma.EventWhereInput {
  if (scope.kind === "season") return { seasonId: scope.seasonId };
  if (scope.kind === "leagues") return { season: { leagueId: { in: scope.leagueIds } } };
  return {};
}

function dateRangeWhereClause(filter: DriverHistoryFilter): Prisma.EventWhereInput {
  if (filter.from == null && filter.to == null) return {};
  const date: Prisma.DateTimeFilter = {};
  if (filter.from != null) date.gte = filter.from;
  if (filter.to != null) date.lte = filter.to;
  return { date };
}

/**
 * Build the full driver-history row set for one driver, in strict
 * chronological order, optionally scoped by league/season/date-range
 * (Task 6's `DriverHistoryFilter`; omit for the legacy default-league,
 * all-time behavior -- see the type's doc comment for the parity contract).
 *
 * M1.17: events sharing a calendar date (a "combined event", M1.15) collapse
 * into ONE row via `buildCombinedHistoryRow` instead of appearing as
 * independent per-session rows. Discovering group membership requires a
 * second, driver-unfiltered query -- the initial per-driver query only
 * returns events this driver personally entered, which would miss a sibling
 * session they skipped (the forfeit case) and so under-detect the group.
 *
 * Task 6: that second query's grouping key is (leagueId, dateKey), not just
 * dateKey -- under an "all leagues" scope there's no league where-clause at
 * all, so two unrelated leagues' events that happen to share a calendar date
 * must still never collapse into one combined-event row together.
 */
export async function buildDriverHistory(
  driverId: number,
  filter: DriverHistoryFilter = {},
  prismaClient: PrismaClient = prisma,
): Promise<DriverHistoryRow[]> {
  const scope = await resolveScope(filter, prismaClient);
  if (scope == null) return [];

  const scopeWhere = scopeWhereClause(scope);
  const dateRangeWhere = dateRangeWhereClause(filter);

  const driverEventDates = await prismaClient.event.findMany({
    where: { entries: { some: { driverId } }, ...scopeWhere, ...dateRangeWhere },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  if (driverEventDates.length === 0) return [];

  // De-duplicated list of every calendar date the driver has any entry on
  // (within scope).
  const dates = Array.from(new Set(driverEventDates.map((d) => d.date.getTime()))).map(
    (t) => new Date(t),
  );

  // Re-fetch every in-scope session sharing one of those dates -- not
  // filtered by driverId -- so a combined-event group resolves with its
  // full sibling session(s) and entrant pool even when this driver only
  // entered one session of the group.
  const events = await loadEventsForDates(prismaClient, dates, scopeWhere);

  // Group by (leagueId, UTC date key) -- see the function doc comment above
  // for why leagueId is part of the key. `events` is already date-ascending,
  // so Map insertion order preserves chronological group order.
  const groupsByKey = new Map<string, LoadedEvent[]>();
  for (const event of events) {
    const dateKey = event.date.toISOString().slice(0, 10);
    const key = `${event.season.leagueId}:${dateKey}`;
    let group = groupsByKey.get(key);
    if (group == null) {
      group = [];
      groupsByKey.set(key, group);
    }
    group.push(event);
  }

  return Array.from(groupsByKey.values()).map((group) =>
    group.length === 1
      ? buildSingleEventRow(group[0]!, driverId)
      : buildCombinedHistoryRow(group, driverId),
  );
}

export type DriverSeasonOption = {
  seasonId: number;
  seasonSlug: string;
  seasonName: string;
  year: number;
  leagueId: number;
  leagueSlug: string;
  leagueName: string;
};

/**
 * Every season a driver has at least one entry in, across every league --
 * powers the driver-stats filter UI's season picker and league-chip set
 * (Task 6). Deliberately ignores any DriverHistoryFilter: the UI needs the
 * driver's full breadth of leagues/seasons to build its options regardless
 * of what's currently selected. Sorted newest-year-first, then by league
 * name, then season name, for a deterministic display order.
 */
export async function listSeasonsForDriver(
  driverId: number,
  client: PrismaClient = prisma,
): Promise<DriverSeasonOption[]> {
  const events = await client.event.findMany({
    where: { entries: { some: { driverId } } },
    select: {
      season: {
        select: {
          id: true,
          slug: true,
          name: true,
          year: true,
          leagueId: true,
          league: { select: { slug: true, name: true } },
        },
      },
    },
  });

  const bySeasonId = new Map<number, DriverSeasonOption>();
  for (const { season } of events) {
    if (bySeasonId.has(season.id)) continue;
    bySeasonId.set(season.id, {
      seasonId: season.id,
      seasonSlug: season.slug,
      seasonName: season.name,
      year: season.year,
      leagueId: season.leagueId,
      leagueSlug: season.league.slug,
      leagueName: season.league.name,
    });
  }

  return Array.from(bySeasonId.values()).sort(
    (a, b) =>
      b.year - a.year ||
      a.leagueName.localeCompare(b.leagueName) ||
      a.seasonName.localeCompare(b.seasonName),
  );
}
