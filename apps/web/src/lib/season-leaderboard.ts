import { PrismaClient, type RunDisposition } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { CONE_PENALTY_MS } from "@/lib/constants";
import { resolveDefaultLeague } from "@/lib/league-config";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { prisma as defaultClient } from "@/lib/prisma";

/**
 * Synthetic class code for the overall PAX standings section
 * (Season.scoringPolicy `paxSection: true`). Rendered pinned first; never
 * stored in the DB.
 */
export const PAX_SECTION_CODE = "PAX";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dynamic qualifying threshold: "clear 51% of the season".
 * floor(N/2) + 1 where N = `max(plannedForYear, actualGroups)` — actual
 * scoring groups ingested so far, raised to the planned season size when the
 * Season row configures one (M1.16), so a mid-season count doesn't shrink
 * the threshold below what the full season will require (M1.15: events
 * sharing a calendar date are auto-grouped into one combined scoring event,
 * so N counts *groups*, not raw `Event` rows).
 * N=6→4, N=7→4, N=8→5.
 *
 * Combined with the per-event invariant codified in PRD §2 ("Data invariants:
 * one class per driver per event"), 2 × threshold > N means a driver who
 * reaches the threshold in any one class cannot also reach it in another
 * class within the same season. The "a driver can only win in one class"
 * rule (M1.14, AX chair 2026-06-08) is therefore enforced by arithmetic,
 * conditioned on that invariant — no per-driver capping code is needed. This
 * still holds under M1.16 since actual ≤ N.
 */
function qualifyingEventCount(totalEventsInSeason: number): number {
  return Math.floor(totalEventsInSeason / 2) + 1;
}

/**
 * How many scores count toward totalPoints right now (`scoringPolicy.drops`).
 *
 * fixed (default, PCA): always the qualifying threshold — mid-season nothing
 * drops because nobody has more than `qualifyingEvents` scores yet.
 * proportional (RMsolo): drops accrue with season progress — at completed C
 * of N events, floor(C × (N−K)/N) scores drop (K = qualifying threshold), so
 * a half-run 10-event best-6 season counts best 3 of 5 ("half the season,
 * half the drops"), converging on exactly best-K-of-N at season end.
 */
export function countedEventTarget(
  totalEvents: number,
  qualifyingEvents: number,
  completedEvents: number,
  mode: "fixed" | "proportional",
): number {
  if (mode === "fixed" || totalEvents === 0) return qualifyingEvents;
  const totalDrops = totalEvents - qualifyingEvents;
  const dropsNow = Math.floor((completedEvents * totalDrops) / totalEvents);
  return Math.max(completedEvents === 0 ? 0 : 1, completedEvents - dropsNow);
}

/**
 * M1.16: derive the season's scoring basis — total (planned-vs-actual max),
 * completed (actual groups ingested so far), and the resulting qualifying
 * threshold. `planned` is the per-year planned-event-count map (the Season
 * row's `plannedEvents` wrapped as `{ [year]: n }` by the caller; tests pass
 * their own map directly). `totalEvents === 0` short-circuits to a 0
 * threshold rather than `qualifyingEventCount(0) === 1`, preserving the
 * pre-M1.16 empty-year contract.
 */
export function seasonScoringBasis(
  year: number,
  actualGroupCount: number,
  planned: Record<number, number>,
): { totalEvents: number; completedEvents: number; qualifyingEvents: number } {
  const totalEvents = Math.max(planned[year] ?? 0, actualGroupCount);
  return {
    totalEvents,
    completedEvents: actualGroupCount,
    qualifyingEvents: totalEvents === 0 ? 0 : qualifyingEventCount(totalEvents),
  };
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
  driverName: string; // "First L." — lastInitial only, never the full last name
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
  totalEvents: number; // season size used for the threshold: max(planned, completedEvents) (M1.16)
  completedEvents: number; // actual scoring groups ingested so far
  qualifyingEvents: number;
  countedEvents: number; // scores counted toward totals right now (== qualifyingEvents in fixed mode; scales with progress in proportional mode — scoringPolicy.drops)
  sections: SeasonStandingsByClass[];
};

// ---------------------------------------------------------------------------
// Internal: per-(event, class, driver) best-time table
// ---------------------------------------------------------------------------

type LoadedEntry = {
  class: { code: string };
  // Prisma Decimal — Number() before arithmetic. paxClass equals the entered
  // class for most entries; run-group classes (M/N/S/P/X-style splits, ported
  // for the RMsolo league in a later PR) carry a distinct derived factor here.
  paxClass: { paxIndex: unknown };
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
 * Resolve the id of the deployment's default League (`resolveDefaultLeague`,
 * shared with the admin membership shim). Returns `null` only if the row
 * named by DEFAULT_LEAGUE_SLUG doesn't exist — `getLeagueConfig` is the
 * caller that throws a clear error for that case; every page reaches it
 * elsewhere in the render tree, so in practice this always resolves.
 */
async function resolveDefaultLeagueId(client: PrismaClient): Promise<number | null> {
  const league = await resolveDefaultLeague(client);
  return league?.id ?? null;
}

/**
 * Return every year with a Season row under the default league, sorted
 * descending (most recent first). Powers the season switcher. Season-driven,
 * not event dates — a league with no Season rows yet returns `[]`.
 */
export async function listSeasonYears(
  client: PrismaClient = defaultClient,
): Promise<number[]> {
  const leagueId = await resolveDefaultLeagueId(client);
  if (leagueId == null) return [];
  const seasons = await client.season.findMany({
    where: { leagueId },
    select: { year: true },
  });
  const years = Array.from(new Set(seasons.map((s) => s.year)));
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
 * alongside sections. `plannedEvents` (M1.16) raises the threshold's season
 * size to the Season row's configured planned count when it exceeds the
 * actual ingested group count, so a mid-season standing doesn't drop scores
 * it shouldn't; see `seasonScoringBasis`.
 *
 * League Foundation: events are scoped to the (default league, year) Season
 * row rather than a raw date range, and every scoring knob — drop mode,
 * synthetic PAX section, class metric, planned event count — comes from that
 * row's `scoringPolicy` JSON (`parseScoringPolicy`), not env vars. A year with
 * no Season row returns the original empty-year shape (all zero, no
 * sections) — same as a year with a Season row but zero ingested events,
 * except `totalEvents` there reflects the Season's planned count instead of 0.
 *
 * Cone-penalty boundary: `scoringPolicy.conePenaltyMs` is read and enforced
 * against the shared `CONE_PENALTY_MS` constant — per-run cone math itself
 * still lives in `entry-best.ts` (and `combined-event.ts`/`leaderboard.ts` for
 * event pages), which stays constant-based this PR, so a season whose policy
 * disagrees with the constant would silently score wrong rather than apply
 * its configured value; this throws instead of allowing that mismatch to
 * pass quietly. Every seeded policy today is 2000, matching the constant, so
 * this never fires in production. Full policy threading of that shared cone
 * math is out of scope here (event-page policy threading beyond PAX display
 * is Task 6+ territory).
 */
export async function buildSeasonLeaderboard(
  year: number,
  client: PrismaClient = defaultClient,
): Promise<SeasonLeaderboardResult> {
  const leagueId = await resolveDefaultLeagueId(client);
  const season = leagueId == null
    ? null
    : await client.season.findFirst({
        where: { leagueId, year },
        include: {
          events: {
            orderBy: { date: "asc" },
            include: {
              entries: {
                include: {
                  class: { select: { code: true } },
                  paxClass: { select: { paxIndex: true } },
                  driver: { select: { id: true, firstName: true, lastInitial: true } },
                  runs: { select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true } },
                },
              },
            },
          },
        },
      });

  if (season == null) {
    return { totalEvents: 0, completedEvents: 0, qualifyingEvents: 0, countedEvents: 0, sections: [] };
  }

  const policy = parseScoringPolicy(season.scoringPolicy);
  if (policy.conePenaltyMs !== CONE_PENALTY_MS) {
    throw new Error(
      `season ${year}: scoringPolicy.conePenaltyMs=${policy.conePenaltyMs} differs from the shared CONE_PENALTY_MS constant (${CONE_PENALTY_MS}ms) used by entry-best.ts/combined-event.ts/leaderboard.ts for per-run cone penalties — those call sites are not yet policy-driven, so a season configured with a different value would silently score with ${CONE_PENALTY_MS}ms instead. Set this season's conePenaltyMs to ${CONE_PENALTY_MS} until per-season cone penalties are wired into per-entry scoring.`,
    );
  }

  // 1. Events for the season, already loaded in chronological order.
  const events: LoadedEvent[] = season.events;
  const plannedEvents: Record<number, number> = { [year]: season.plannedEvents };

  if (events.length === 0) {
    const basis = seasonScoringBasis(year, 0, plannedEvents);
    return { ...basis, countedEvents: basis.qualifyingEvents, sections: [] };
  }

  const driverInfo = new Map<number, { firstName: string; lastInitial: string }>();

  // The synthetic PAX section is skipped entirely if a real class named "PAX"
  // ever appears in the data — the real class wins, never silently merged.
  const realPaxClassExists = events.some((ev) =>
    ev.entries.some((e) => e.class.code === PAX_SECTION_CODE),
  );
  const paxSectionEnabled = policy.paxSection && !realPaxClassExists;
  if (policy.paxSection && realPaxClassExists) {
    console.warn(
      `[season-leaderboard] season ${year}: a real class named '${PAX_SECTION_CODE}' exists — skipping the synthetic overall-PAX section (scoringPolicy.paxSection=true)`,
    );
  }

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
      // Class metric (scoringPolicy.classMetric): raw best by default. Under
      // "pax", classes score on the PAX-indexed best instead — a pure
      // rescale (identical order and points) for classes whose entries share
      // one factor, and the official ordering for run-group classes whose
      // entries carry per-driver derived factors (the printed group results
      // are indexed).
      const classMetric = policy.classMetric === "pax"
        ? Math.round(best * Number(entry.paxClass.paxIndex))
        : best;
      const existing = byDriver.get(d.id);
      if (existing == null || classMetric < existing) {
        byDriver.set(d.id, classMetric);
      }

      // Synthetic overall-PAX section (scoringPolicy.paxSection=true): index
      // the same best-corrected time by the entry's paxClass factor and rank
      // across every class. Everything downstream (points formula, combined
      // groups, qualifying threshold, drops) treats it as one more class.
      if (paxSectionEnabled) {
        const paxMs = Math.round(best * Number(entry.paxClass.paxIndex));
        let paxByDriver = byClass.get(PAX_SECTION_CODE);
        if (paxByDriver == null) {
          paxByDriver = new Map();
          byClass.set(PAX_SECTION_CODE, paxByDriver);
        }
        const existingPax = paxByDriver.get(d.id);
        if (existingPax == null || paxMs < existingPax) {
          paxByDriver.set(d.id, paxMs);
        }
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
  const { totalEvents, completedEvents, qualifyingEvents } = seasonScoringBasis(
    year,
    scoringGroups.length,
    plannedEvents,
  );
  const countedEvents = countedEventTarget(
    totalEvents,
    qualifyingEvents,
    completedEvents,
    policy.drops,
  );

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
  //    top-countedEvents scores; the rest are rendered but visually muted.
  const classBuckets = new Map<string, SeasonStandingsRow[]>();

  for (const [key, rawScores] of rawScoresByPair) {
    const [driverIdStr, classCode] = key.split("|");
    if (driverIdStr == null || classCode == null) continue;
    const driverId = Number(driverIdStr);

    const info = driverInfo.get(driverId);
    if (info == null) continue;

    // Sort desc by points to decide which scores are counted vs. dropped.
    // scoringPolicy.drops="proportional" scales the counted target with
    // season progress (see countedEventTarget); "fixed" keeps the historical
    // best-qualifyingEvents behavior.
    const sorted = [...rawScores].sort((a, b) => b.points - a.points);
    const counted = sorted.slice(0, countedEvents);
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
  //    Then sort class sections alphabetically for rendering stability,
  //    except the synthetic PAX section, which always pins first.
  const sections: SeasonStandingsByClass[] = [];
  for (const [classCode, drivers] of classBuckets) {
    drivers.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.driverName.localeCompare(b.driverName);
    });
    sections.push({ classCode, drivers });
  }

  sections.sort((a, b) => {
    if (a.classCode === PAX_SECTION_CODE) return -1;
    if (b.classCode === PAX_SECTION_CODE) return 1;
    return a.classCode.localeCompare(b.classCode);
  });
  return { totalEvents, completedEvents, qualifyingEvents, countedEvents, sections };
}
