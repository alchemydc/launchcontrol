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
 *
 * Because the threshold is strictly greater than N/2, a driver who runs at
 * least the threshold count in any one class cannot also reach it in another
 * class (2 × threshold > N). The "a driver can only win in one class" rule
 * (M1.14, AX chair 2026-06-08) is therefore enforced by arithmetic — no
 * special code is needed to limit a driver to a single official class.
 */
function qualifyingEventCount(totalEventsInSeason: number): number {
  return Math.floor(totalEventsInSeason / 2) + 1;
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
 * A driver appears in every class they competed in. For each (driver, class)
 * pair, all of that driver's entries in that class score points — multiple
 * cars within the same class all count. Per-class eligibility (Official vs.
 * Provisional) is computed independently from each pair's scoring-event count
 * against the dynamic qualifying threshold.
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
  //    earned for this event in this class. Co-drive collapse: if a driver
  //    somehow has multiple entries in the same class at the same event (rare;
  //    AGENTS-known invariant says this shouldn't happen because co-drives use
  //    distinct Driver records), keep the higher score.
  const eventClassPoints: Map<
    number, // eventId
    Map<
      string, // classCode
      Map<number, { points: number; eventSlug: string; eventName: string; eventDate: Date }>
    >
  > = new Map();

  const driverInfo = new Map<number, { firstName: string; lastInitial: string }>();

  for (const event of events) {
    const byClass = new Map<string, Array<{ driverId: number; bestMs: number }>>();

    for (const entry of event.entries) {
      const d = entry.driver;
      if (!driverInfo.has(d.id)) {
        driverInfo.set(d.id, { firstName: d.firstName, lastInitial: d.lastInitial });
      }

      const code = entry.class.code;
      const best = bestCorrectedMsForEntry(entry);
      if (best == null) continue; // no CLEAN run or committed best — excluded from event scoring

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

  // 3. Build per-(driver, class) season scores. A driver gets one bucket per
  //    class they entered, including off-class participation in any number of
  //    additional classes.
  type RawScore = {
    eventId: number;
    eventSlug: string;
    eventName: string;
    eventDate: Date;
    points: number;
  };

  const pairKey = (driverId: number, classCode: string) => `${driverId}|${classCode}`;
  const rawScoresByPair = new Map<string, RawScore[]>();

  for (const [eventId, classMap] of eventClassPoints) {
    for (const [classCode, driverMap] of classMap) {
      for (const [driverId, info] of driverMap) {
        const key = pairKey(driverId, classCode);
        let arr = rawScoresByPair.get(key);
        if (arr == null) {
          arr = [];
          rawScoresByPair.set(key, arr);
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

  // 4. Assemble final rows per (driver, class). totalPoints comes from the
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
    const countedSet = new Set(counted.map((s) => s.eventId));

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

  // 5. Sort each class bucket: totalPoints desc, then driverName asc.
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
