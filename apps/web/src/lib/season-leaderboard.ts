import { PrismaClient } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { prisma as defaultClient } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dynamic qualifying threshold: "clear 51% of the season".
 * floor(N/2) + 1 where N = total events in the season.
 * N=6→4, N=7→4, N=8→5.
 */
function qualifyingEventCount(totalEventsInSeason: number): number {
  return Math.floor(totalEventsInSeason / 2) + 1;
}

/**
 * Normalize a car description for grouping purposes.
 * Keys on description only (not car number), because car numbers float
 * per-event for drivers without permanent numbers.
 */
function normalizeCarKey(description: string | null): string {
  return (description ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SeasonStandingsRow = {
  driverId: number;
  driverName: string; // "First L." — lastInitial only, never full last name
  totalPoints: number;
  eligible: boolean; // false when driver has fewer than qualifyingEvents in their season class
  eventsCountedInClass: number;
  qualifyingEvents: number; // threshold for this season (duplicated for per-driver badge rendering)
  primaryCar: { carDescription: string | null } | null; // null only when driver has no scoring entries
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

export type SeasonLeaderboardResult = {
  totalEvents: number;
  qualifyingEvents: number;
  sections: SeasonStandingsByClass[];
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
 * Each class section contains all drivers whose season class is that class,
 * sorted by totalPoints desc, then driverName asc.  Classes with no eligible
 * or provisional drivers are omitted.
 *
 * Returns total event count and computed qualifying threshold alongside sections.
 */
export async function buildSeasonLeaderboard(
  year: number,
  client: PrismaClient = defaultClient,
): Promise<SeasonLeaderboardResult> {
  // 1. Load all events + entries + runs for the season in chronological order.
  const events = await client.event.findMany({
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

  const totalEvents = events.length;
  const qualifyingEvents = qualifyingEventCount(totalEvents);

  // 2. Score each (event, class) group.
  //
  //    eventClassPoints[eventId][classCode][driverId] = best points that driver
  //    earned for this event in this class (taking the higher score if a driver
  //    somehow has multiple entries — vanishingly rare, documented by schema).
  //    carKey is stored alongside so the primary-car filter can consult it.
  const eventClassPoints: Map<
    number, // eventId
    Map<
      string, // classCode
      Map<number, { points: number; eventSlug: string; eventName: string; eventDate: Date; carKey: string }>
    >
  > = new Map();

  for (const event of events) {
    const byClass = new Map<string, Array<{ driverId: number; bestMs: number; carKey: string }>>();

    for (const entry of event.entries) {
      const code = entry.class.code;
      const best = bestCorrectedMsForEntry(entry);
      if (best == null) continue; // no CLEAN run or committed best — excluded from event scoring

      let arr = byClass.get(code);
      if (arr == null) {
        arr = [];
        byClass.set(code, arr);
      }
      arr.push({ driverId: entry.driver.id, bestMs: best, carKey: normalizeCarKey(entry.carDescription) });
    }

    const classMap = new Map<
      string,
      Map<number, { points: number; eventSlug: string; eventName: string; eventDate: Date; carKey: string }>
    >();

    for (const [classCode, scorers] of byClass) {
      const fastest = Math.min(...scorers.map((s) => s.bestMs));
      const driverMap = new Map<
        number,
        { points: number; eventSlug: string; eventName: string; eventDate: Date; carKey: string }
      >();

      for (const { driverId, bestMs, carKey } of scorers) {
        const pts = Math.round((1000 * fastest) / bestMs);
        const existing = driverMap.get(driverId);
        // Per-event collapse: if a driver has multiple entries in the same class
        // at the same event (co-drive edge case), keep the higher score.
        // The winning entry's carKey is retained.
        if (existing == null || pts > existing.points) {
          driverMap.set(driverId, {
            points: pts,
            eventSlug: event.slug,
            eventName: event.name,
            eventDate: event.date,
            carKey,
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

  // 4. Derive each driver's primary car within their season class.
  //    Group entries (in chronological event order) by normalizeCarKey(carDescription).
  //    Primary car = max entryCount; tiebreak = max cumulative points; final tiebreak = earliest event date.
  //    The displayDescription uses the chronologically-latest original-cased carDescription in the group.
  const driverPrimaryCar = new Map<number, { carKey: string; displayDescription: string | null }>();

  for (const driverId of driverSeasonClass.keys()) {
    const seasonClass = driverSeasonClass.get(driverId)!;

    // Per-carKey stats for this driver in their season class.
    const carStats = new Map<string, {
      entryCount: number;
      cumulativePoints: number;
      earliestEventDate: Date | null;
      latestDescription: string | null; // original-cased, from chronologically latest entry
    }>();

    for (const event of events) {
      const eventPoints = eventClassPoints.get(event.id)?.get(seasonClass)?.get(driverId);
      if (eventPoints == null) continue; // driver didn't score in this event+class

      const carKey = eventPoints.carKey;
      const existing = carStats.get(carKey);
      if (existing == null) {
        // Find the original-cased description from the entry for this event.
        // We look it up from the events entries directly.
        const entry = event.entries.find(
          (e) => e.driver.id === driverId && e.class.code === seasonClass
        );
        const origDesc = entry?.carDescription ?? null;
        carStats.set(carKey, {
          entryCount: 1,
          cumulativePoints: eventPoints.points,
          earliestEventDate: event.date,
          latestDescription: origDesc,
        });
      } else {
        existing.entryCount += 1;
        existing.cumulativePoints += eventPoints.points;
        // Update latestDescription to the most recent event's value (events sorted asc)
        const entry = event.entries.find(
          (e) => e.driver.id === driverId && e.class.code === seasonClass
        );
        existing.latestDescription = entry?.carDescription ?? existing.latestDescription;
      }
    }

    if (carStats.size === 0) continue;

    // Pick primary car: max entryCount → max cumulativePoints → earliest date.
    let primaryKey: string | null = null;
    let primaryDisplay: string | null = null;
    let bestCount = -1;
    let bestPoints = -1;
    let bestDate: Date | null = null;

    for (const [carKey, stats] of carStats) {
      const wins =
        stats.entryCount > bestCount ||
        (stats.entryCount === bestCount && stats.cumulativePoints > bestPoints) ||
        (stats.entryCount === bestCount &&
          stats.cumulativePoints === bestPoints &&
          bestDate != null &&
          stats.earliestEventDate != null &&
          stats.earliestEventDate < bestDate);
      if (wins) {
        primaryKey = carKey;
        primaryDisplay = stats.latestDescription;
        bestCount = stats.entryCount;
        bestPoints = stats.cumulativePoints;
        bestDate = stats.earliestEventDate;
      }
    }

    if (primaryKey != null) {
      driverPrimaryCar.set(driverId, { carKey: primaryKey, displayDescription: primaryDisplay });
    }
  }

  // 5. Build per-driver season scores (filtered to season class AND primary car only).
  //    Collect raw event scores, then sort desc, mark best-N as counted.
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

        // Single-car constraint: exclude entries not in the driver's primary car.
        const primary = driverPrimaryCar.get(driverId);
        if (primary == null || info.carKey !== primary.carKey) continue;

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

  // 6. Assemble final rows per class.
  //    Group by season class, compute totalPoints from top-qualifyingEvents scores.
  const classBuckets = new Map<string, SeasonStandingsRow[]>();

  for (const [driverId, rawScores] of driverRawScores) {
    const seasonClass = driverSeasonClass.get(driverId);
    if (seasonClass == null) continue;

    const info = driverInfo.get(driverId);
    if (info == null) continue;

    const primary = driverPrimaryCar.get(driverId);
    const primaryCar = primary != null
      ? { carDescription: primary.displayDescription }
      : null;

    // Sort desc by points to determine which are counted vs dropped
    const sorted = [...rawScores].sort((a, b) => b.points - a.points);
    const counted = sorted.slice(0, qualifyingEvents);
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

    const eventsCountedInClass = scores.length; // total events scored in season class (primary car only)
    const eligible = eventsCountedInClass >= qualifyingEvents;

    const row: SeasonStandingsRow = {
      driverId,
      driverName: `${info.firstName} ${info.lastInitial}`,
      totalPoints,
      eligible,
      eventsCountedInClass,
      qualifyingEvents,
      primaryCar,
      scores,
    };

    let bucket = classBuckets.get(seasonClass);
    if (bucket == null) {
      bucket = [];
      classBuckets.set(seasonClass, bucket);
    }
    bucket.push(row);
  }

  // 7. Sort each class bucket: totalPoints desc, then driverName asc.
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
