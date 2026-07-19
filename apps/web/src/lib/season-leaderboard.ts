import { PrismaClient, type RunDisposition } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { prisma as defaultClient } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dynamic qualifying threshold: "clear 51% of the season".
 * floor(N/2) + 1 where N = total scoring groups in the season (M1.15: events
 * sharing a calendar date are auto-grouped into one combined scoring event,
 * so N counts *groups*, not raw `Event` rows).
 * N=6→4, N=7→4, N=8→5.
 *
 * Combined with the per-event invariant codified in PRD §2 ("Data invariants:
 * one class per driver per event"), 2 × threshold > N means a driver who
 * reaches the threshold in any one class cannot also reach it in another
 * class within the same season. The "a driver can only win in one class"
 * rule (M1.14, AX chair 2026-06-08) is therefore enforced by arithmetic,
 * conditioned on that invariant — no per-driver capping code is needed.
 */
function qualifyingEventCount(totalEventsInSeason: number): number {
  return Math.floor(totalEventsInSeason / 2) + 1;
}

/**
 * Combined-event display label (M1.15): strip a trailing parenthesized
 * token from each session name (e.g. "Cone in 60 Seconds (A)" →
 * "Cone in 60 Seconds"). If every session's stripped name agrees, use that
 * shared label; otherwise fall back to the full name of the
 * lowest-`id` (earliest-ingested) session in the group.
 *
 * Exported for reuse by `combined-event.ts` (combined page header) and unit
 * tests. The strip applies to a single-element input too — a lone session
 * named "Foo (A)" labels as "Foo", same as the full group would.
 */
export function combinedEventLabel(
  events: Array<{ id: number; name: string }>,
): string {
  if (events.length === 0) return "";
  const strip = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const stripped = events.map((e) => strip(e.name));
  const first = stripped[0];
  const allAgree = first != null && first.length > 0 && stripped.every((s) => s === first);
  if (allAgree && first != null) return first;
  const earliest = [...events].sort((a, b) => a.id - b.id)[0];
  return earliest?.name ?? "";
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SeasonStandingsRow = {
  driverId: number;
  driverName: string; // "First L." — lastInitial only, never full last name
  totalPoints: number;
  eligible: boolean; // false when driver has fewer than qualifyingEvents in this class
  eventsCountedInClass: number;
  qualifyingEvents: number; // threshold for this season (duplicated for per-driver badge rendering)
  scores: Array<{
    key: string; // stable React key — event slug, or "combined-<dateKey>" for a combined group
    eventName: string; // combined-group label for multi-session groups (see combinedEventLabel)
    eventDate: Date;
    points: number;
    dropped: boolean; // true when this score was NOT counted toward totalPoints
    combined: boolean; // true when this score represents a multi-session combined scoring group
    href: string; // link target — `/events/[slug]` or `/events/combined/[date]`
  }>;
};

export type SeasonStandingsByClass = {
  classCode: string;
  drivers: SeasonStandingsRow[]; // sorted by totalPoints desc, then driverName asc
};

export type SeasonLeaderboardResult = {
  totalEvents: number;
  qualifyingEvents: number;
  sections: SeasonStandingsByClass[];
};

// ---------------------------------------------------------------------------
// Internal: per-(event, class, driver) best-time table
// ---------------------------------------------------------------------------

type LoadedEntry = {
  class: { code: string };
  driver: { id: number; firstName: string; lastInitial: string };
  bestCommittedRunNumber: number | null;
  runs: Array<{ runNumber: number; rawTimeMs: number | null; cones: number; disposition: RunDisposition }>;
};

type LoadedEvent = {
  id: number;
  slug: string;
  name: string;
  date: Date;
  entries: LoadedEntry[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return every distinct calendar year that has at least one event in the DB,
 * sorted descending (most recent first).  Powers the season switcher.
 */
export async function listSeasonYears(
  client: PrismaClient = defaultClient,
): Promise<number[]> {
  const events = await client.event.findMany({ select: { date: true } });
  const years = Array.from(new Set(events.map((e) => e.date.getUTCFullYear())));
  return years.sort((a, b) => b - a);
}

/**
 * Build the full season leaderboard for a given calendar year.
 *
 * A driver appears in every class they competed in. For each (driver, class)
 * pair, all of that driver's entries in that class score points — multiple
 * cars within the same class all count. Per-class eligibility (Official vs.
 * Provisional) is computed independently from each pair's scoring-event count
 * against the dynamic qualifying threshold.
 *
 * M1.15: events sharing a calendar date form one *scoring group*. A
 * single-event group scores exactly as before. A multi-event group scores
 * on **summed** best-corrected time across every session in the group — a
 * driver only qualifies for a class in that group when they have a countable
 * (CLEAN, per `bestCorrectedMsForEntry`) time in that same class in *every*
 * session of the group; a missing session or a cross-session class mismatch
 * excludes them from that group's scoring entirely (no special-case code
 * needed — it falls out of requiring the same classCode key to be present in
 * every session).
 *
 * Returns total scoring-group count and computed qualifying threshold
 * alongside sections.
 */
export async function buildSeasonLeaderboard(
  year: number,
  client: PrismaClient = defaultClient,
): Promise<SeasonLeaderboardResult> {
  // 1. Load all events + entries + runs for the season in chronological order.
  const events: LoadedEvent[] = await client.event.findMany({
    where: {
      date: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
    orderBy: { date: "asc" },
    include: {
      entries: {
        include: {
          class: { select: { code: true } },
          driver: { select: { id: true, firstName: true, lastInitial: true } },
          runs: { select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true } },
        },
      },
    },
  });

  if (events.length === 0) return { totalEvents: 0, qualifyingEvents: 0, sections: [] };

  const driverInfo = new Map<number, { firstName: string; lastInitial: string }>();

  // 2. Per (event, class, driver) best-corrected-ms table. Defense-in-depth:
  //    if a driver somehow has multiple entries in the same class at the same
  //    event, keep the faster one. Per PRD §2 ("Data invariants") this should
  //    never happen — co-drives resolve to distinct Driver records via the
  //    identity-hash dedupe in ingest.ts, and the per-event one-class rule
  //    bars the other pathway — but the schema does not enforce uniqueness,
  //    so we collapse defensively rather than throw.
  const bestByEventClassDriver = new Map<number, Map<string, Map<number, number>>>();

  for (const event of events) {
    const byClass = new Map<string, Map<number, number>>();
    for (const entry of event.entries) {
      const d = entry.driver;
      if (!driverInfo.has(d.id)) {
        driverInfo.set(d.id, { firstName: d.firstName, lastInitial: d.lastInitial });
      }

      const best = bestCorrectedMsForEntry(entry);
      if (best == null) continue; // no CLEAN run or committed best — excluded from event scoring

      const code = entry.class.code;
      let byDriver = byClass.get(code);
      if (byDriver == null) {
        byDriver = new Map();
        byClass.set(code, byDriver);
      }
      const existing = byDriver.get(d.id);
      if (existing == null || best < existing) {
        byDriver.set(d.id, best);
      }
    }
    bestByEventClassDriver.set(event.id, byClass);
  }

  // 3. Group events into scoring groups by UTC date key. `events` is already
  //    date-ascending, so grouping via Map insertion order preserves
  //    chronological group order.
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
  const scoringGroups = Array.from(groupsByDateKey.entries());
  const totalEvents = scoringGroups.length;
  const qualifyingEvents = qualifyingEventCount(totalEvents);

  // 4. Score each scoring group, per class. Multi-event groups score on
  //    summed best-corrected time; single-event groups score exactly as
  //    M1.14 did.
  type RawScore = {
    key: string;
    eventName: string;
    eventDate: Date;
    points: number;
    combined: boolean;
    href: string;
  };

  const pairKey = (driverId: number, classCode: string) => `${driverId}|${classCode}`;
  const rawScoresByPair = new Map<string, RawScore[]>();

  const pushScore = (driverId: number, classCode: string, score: RawScore) => {
    const key = pairKey(driverId, classCode);
    let arr = rawScoresByPair.get(key);
    if (arr == null) {
      arr = [];
      rawScoresByPair.set(key, arr);
    }
    arr.push(score);
  };

  for (const [dateKey, group] of scoringGroups) {
    if (group.length === 1) {
      // Single-event group — identical to pre-M1.15 per-event scoring.
      const event = group[0]!;
      const byClass = bestByEventClassDriver.get(event.id)!;
      for (const [classCode, byDriver] of byClass) {
        const fastest = Math.min(...byDriver.values());
        for (const [driverId, bestMs] of byDriver) {
          const points = Math.round((1000 * fastest) / bestMs);
          pushScore(driverId, classCode, {
            key: event.slug,
            eventName: event.name,
            eventDate: event.date,
            points,
            combined: false,
            href: `/events/${event.slug}`,
          });
        }
      }
      continue;
    }

    // Multi-event (combined) group. Union of class codes seen across the
    // group's sessions.
    const classCodes = new Set<string>();
    for (const event of group) {
      for (const classCode of bestByEventClassDriver.get(event.id)!.keys()) {
        classCodes.add(classCode);
      }
    }

    const combinedLabel = combinedEventLabel(group);
    const groupDate = group[0]!.date;
    const href = `/events/combined/${dateKey}`;

    for (const classCode of classCodes) {
      // A driver qualifies only when every session in the group has a best
      // time for them in this exact class — sum those bests. Missing a
      // session, or racing a different class in another session, naturally
      // excludes them (no entry in this class in that session).
      const combinedByDriver = new Map<number, number>();
      const driverIds = new Set<number>();
      for (const event of group) {
        const byDriver = bestByEventClassDriver.get(event.id)!.get(classCode);
        if (byDriver == null) continue;
        for (const driverId of byDriver.keys()) driverIds.add(driverId);
      }
      for (const driverId of driverIds) {
        let sum = 0;
        let qualifiesAll = true;
        for (const event of group) {
          const best = bestByEventClassDriver.get(event.id)!.get(classCode)?.get(driverId);
          if (best == null) {
            qualifiesAll = false;
            break;
          }
          sum += best;
        }
        if (qualifiesAll) combinedByDriver.set(driverId, sum);
      }

      if (combinedByDriver.size === 0) continue;
      const fastestSum = Math.min(...combinedByDriver.values());
      for (const [driverId, sumMs] of combinedByDriver) {
        const points = Math.round((1000 * fastestSum) / sumMs);
        pushScore(driverId, classCode, {
          key: `combined-${dateKey}`,
          eventName: combinedLabel,
          eventDate: groupDate,
          points,
          combined: true,
          href,
        });
      }
    }
  }

  // 5. Assemble final rows per (driver, class). totalPoints comes from the
  //    top-qualifyingEvents scores; the rest are rendered but visually muted.
  const classBuckets = new Map<string, SeasonStandingsRow[]>();

  for (const [key, rawScores] of rawScoresByPair) {
    const [driverIdStr, classCode] = key.split("|");
    if (driverIdStr == null || classCode == null) continue;
    const driverId = Number(driverIdStr);

    const info = driverInfo.get(driverId);
    if (info == null) continue;

    // Sort desc by points to decide which scores are counted vs. dropped.
    const sorted = [...rawScores].sort((a, b) => b.points - a.points);
    const counted = sorted.slice(0, qualifyingEvents);
    const totalPoints = counted.reduce((sum, s) => sum + s.points, 0);
    const countedSet = new Set(counted.map((s) => s.key));

    const scores = rawScores
      .slice()
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())
      .map((s) => ({
        key: s.key,
        eventName: s.eventName,
        eventDate: s.eventDate,
        points: s.points,
        dropped: !countedSet.has(s.key),
        combined: s.combined,
        href: s.href,
      }));

    const eventsCountedInClass = scores.length;
    const eligible = eventsCountedInClass >= qualifyingEvents;

    const row: SeasonStandingsRow = {
      driverId,
      driverName: `${info.firstName} ${info.lastInitial}`,
      totalPoints,
      eligible,
      eventsCountedInClass,
      qualifyingEvents,
      scores,
    };

    let bucket = classBuckets.get(classCode);
    if (bucket == null) {
      bucket = [];
      classBuckets.set(classCode, bucket);
    }
    bucket.push(row);
  }

  // 6. Sort each class bucket: totalPoints desc, then driverName asc.
  //    Then sort class sections alphabetically for rendering stability.
  const sections: SeasonStandingsByClass[] = [];
  for (const [classCode, drivers] of classBuckets) {
    drivers.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.driverName.localeCompare(b.driverName);
    });
    sections.push({ classCode, drivers });
  }

  sections.sort((a, b) => a.classCode.localeCompare(b.classCode));
  return { totalEvents, qualifyingEvents, sections };
}
