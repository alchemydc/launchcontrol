import { PrismaClient } from "@/generated/prisma/client";
import { CONE_PENALTY_MS } from "@/lib/constants";
import { prisma as defaultClient } from "@/lib/prisma";

// RMR PCA 2026 season rules (region-specific constants)
const MIN_EVENTS_FOR_ELIGIBILITY = 4; // fewer than this = "Provisional"
const COUNTED_SCORES_PER_DRIVER = 4; // best-4-of-N toward season total

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SeasonStandingsRow = {
  driverId: number;
  driverName: string; // "First L." — lastInitial only, never full last name
  totalPoints: number;
  eligible: boolean; // false when driver has < MIN_EVENTS_FOR_ELIGIBILITY in their season class
  eventsCountedInClass: number;
  scores: Array<{
    eventId: number;
    eventSlug: string;
    eventName: string;
    eventDate: Date;
    points: number;
    dropped: boolean; // true when this score was NOT counted toward totalPoints
  }>;
};

export type SeasonStandingsByClass = {
  classCode: string;
  drivers: SeasonStandingsRow[]; // sorted by totalPoints desc, then driverName asc
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the best clean cone-corrected time for a set of runs (no PAX). */
function bestCorrectedMs(
  runs: Array<{
    rawTimeMs: number | null;
    cones: number;
    disposition: string;
  }>,
): number | null {
  const cleanCorrected = runs
    .filter((r) => r.disposition === "CLEAN" && r.rawTimeMs != null)
    .map((r) => (r.rawTimeMs as number) + r.cones * CONE_PENALTY_MS);
  return cleanCorrected.length > 0 ? Math.min(...cleanCorrected) : null;
}

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
  const years = Array.from(new Set(events.map((e) => e.date.getFullYear())));
  return years.sort((a, b) => b - a);
}

/**
 * Build the full season leaderboard for a given calendar year.
 *
 * Each class section contains all drivers whose season class is that class,
 * sorted by totalPoints desc, then driverName asc.  Classes with no eligible
 * or provisional drivers are omitted.
 */
export async function buildSeasonLeaderboard(
  year: number,
  client: PrismaClient = defaultClient,
): Promise<SeasonStandingsByClass[]> {
  // 1. Load all events + entries + runs for the season in chronological order.
  const events = await client.event.findMany({
    where: {
      date: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
    orderBy: { date: "asc" },
    include: {
      entries: {
        include: {
          class: { select: { code: true } },
          driver: { select: { id: true, firstName: true, lastInitial: true } },
          runs: { select: { rawTimeMs: true, cones: true, disposition: true } },
        },
      },
    },
  });

  if (events.length === 0) return [];

  // 2. Score each (event, class) group.
  //
  //    eventClassPoints[eventId][classCode][driverId] = best points that driver
  //    earned for this event in this class (taking the higher score if a driver
  //    somehow has multiple entries — vanishingly rare, documented by schema).
  const eventClassPoints: Map<
    number, // eventId
    Map<
      string, // classCode
      Map<number, { points: number; eventSlug: string; eventName: string; eventDate: Date }>
    >
  > = new Map();

  for (const event of events) {
    const byClass = new Map<string, Array<{ driverId: number; bestMs: number }>>();

    for (const entry of event.entries) {
      const code = entry.class.code;
      const best = bestCorrectedMs(entry.runs);
      if (best == null) continue; // no CLEAN run — excluded from event scoring

      let arr = byClass.get(code);
      if (arr == null) {
        arr = [];
        byClass.set(code, arr);
      }
      arr.push({ driverId: entry.driver.id, bestMs: best });
    }

    const classMap = new Map<
      string,
      Map<number, { points: number; eventSlug: string; eventName: string; eventDate: Date }>
    >();

    for (const [classCode, scorers] of byClass) {
      const fastest = Math.min(...scorers.map((s) => s.bestMs));
      const driverMap = new Map<
        number,
        { points: number; eventSlug: string; eventName: string; eventDate: Date }
      >();

      for (const { driverId, bestMs } of scorers) {
        const pts = Math.round((1000 * fastest) / bestMs);
        const existing = driverMap.get(driverId);
        // Per-event collapse: if a driver has multiple entries in the same class
        // at the same event (co-drive edge case), keep the higher score.
        if (existing == null || pts > existing.points) {
          driverMap.set(driverId, {
            points: pts,
            eventSlug: event.slug,
            eventName: event.name,
            eventDate: event.date,
          });
        }
      }

      classMap.set(classCode, driverMap);
    }

    eventClassPoints.set(event.id, classMap);
  }

  // 3. Derive each driver's season class (= class with most Entry rows;
  //    ties broken by earliest event date in that class).
  //
  //    Walk events in chronological order (already sorted asc above).
  const driverClassStats = new Map<
    number, // driverId
    Map<string, { entryCount: number; earliestEventDate: Date }>
  >();

  for (const event of events) {
    for (const entry of event.entries) {
      const dId = entry.driver.id;
      const code = entry.class.code;

      let classMap = driverClassStats.get(dId);
      if (classMap == null) {
        classMap = new Map();
        driverClassStats.set(dId, classMap);
      }

      const existing = classMap.get(code);
      if (existing == null) {
        classMap.set(code, { entryCount: 1, earliestEventDate: event.date });
      } else {
        existing.entryCount += 1;
        // earliestEventDate is already the earliest because events are sorted asc
      }
    }
  }

  // For each driver, pick the season class: highest entryCount, tiebreak = earliest date.
  const driverSeasonClass = new Map<number, string>();
  const driverInfo = new Map<
    number,
    { firstName: string; lastInitial: string }
  >();

  // Also collect driver info while iterating entries
  for (const event of events) {
    for (const entry of event.entries) {
      const d = entry.driver;
      if (!driverInfo.has(d.id)) {
        driverInfo.set(d.id, {
          firstName: d.firstName,
          lastInitial: d.lastInitial,
        });
      }
    }
  }

  for (const [dId, classMap] of driverClassStats) {
    let bestClass: string | null = null;
    let bestCount = -1;
    let bestDate: Date | null = null;

    for (const [code, stats] of classMap) {
      const wins =
        stats.entryCount > bestCount ||
        (stats.entryCount === bestCount &&
          bestDate != null &&
          stats.earliestEventDate < bestDate);
      if (wins) {
        bestClass = code;
        bestCount = stats.entryCount;
        bestDate = stats.earliestEventDate;
      }
    }

    if (bestClass != null) {
      driverSeasonClass.set(dId, bestClass);
    }
  }

  // 4. Build per-driver season scores (filtered to season class only).
  //    Collect raw event scores, then sort desc, mark best-4 as counted.
  type RawScore = {
    eventId: number;
    eventSlug: string;
    eventName: string;
    eventDate: Date;
    points: number;
  };

  const driverRawScores = new Map<number, RawScore[]>();

  for (const [eventId, classMap] of eventClassPoints) {
    for (const [classCode, driverMap] of classMap) {
      for (const [driverId, info] of driverMap) {
        const seasonClass = driverSeasonClass.get(driverId);
        if (seasonClass !== classCode) continue; // off-class — excluded

        let arr = driverRawScores.get(driverId);
        if (arr == null) {
          arr = [];
          driverRawScores.set(driverId, arr);
        }
        arr.push({
          eventId,
          eventSlug: info.eventSlug,
          eventName: info.eventName,
          eventDate: info.eventDate,
          points: info.points,
        });
      }
    }
  }

  // 5. Assemble final rows per class.
  //    Group by season class, compute totalPoints from top-COUNTED_SCORES_PER_DRIVER.
  const classBuckets = new Map<string, SeasonStandingsRow[]>();

  for (const [driverId, rawScores] of driverRawScores) {
    const seasonClass = driverSeasonClass.get(driverId);
    if (seasonClass == null) continue;

    const info = driverInfo.get(driverId);
    if (info == null) continue;

    // Sort desc by points to determine which are counted vs dropped
    const sorted = [...rawScores].sort((a, b) => b.points - a.points);
    const counted = sorted.slice(0, COUNTED_SCORES_PER_DRIVER);
    const totalPoints = counted.reduce((sum, s) => sum + s.points, 0);
    const countedSet = new Set(counted.map((s) => s.eventId));

    // Scores rendered in event chronological order for the UI
    const scores = rawScores
      .slice()
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())
      .map((s) => ({
        eventId: s.eventId,
        eventSlug: s.eventSlug,
        eventName: s.eventName,
        eventDate: s.eventDate,
        points: s.points,
        dropped: !countedSet.has(s.eventId),
      }));

    const eventsCountedInClass = scores.length; // total events scored in season class
    const eligible = eventsCountedInClass >= MIN_EVENTS_FOR_ELIGIBILITY;

    const row: SeasonStandingsRow = {
      driverId,
      driverName: `${info.firstName} ${info.lastInitial}`,
      totalPoints,
      eligible,
      eventsCountedInClass,
      scores,
    };

    let bucket = classBuckets.get(seasonClass);
    if (bucket == null) {
      bucket = [];
      classBuckets.set(seasonClass, bucket);
    }
    bucket.push(row);
  }

  // 6. Sort each class bucket: totalPoints desc, then driverName asc.
  //    Then sort class sections alphabetically for rendering stability.
  const result: SeasonStandingsByClass[] = [];
  for (const [classCode, drivers] of classBuckets) {
    drivers.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.driverName.localeCompare(b.driverName);
    });
    result.push({ classCode, drivers });
  }

  result.sort((a, b) => a.classCode.localeCompare(b.classCode));
  return result;
}
