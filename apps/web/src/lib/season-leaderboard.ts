import { Prisma, PrismaClient, type RunDisposition } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { resolveDefaultLeague } from "@/lib/league-config";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { appliedPaxIndex } from "@/lib/pax-applied";
import { loadCarClassMap, requireCarClass } from "@/lib/car-class-map";
import { awardPoints } from "@/lib/event-points";
import { prisma as defaultClient } from "@/lib/prisma";

/**
 * Synthetic class code for the overall PAX standings section
 * (ruleset policy `paxSection: true`). Rendered pinned first; never
 * stored in the DB.
 */
export const PAX_SECTION_CODE = "PAX";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * How many scores count toward totalPoints right now (the ruleset policy's
 * `dropCount` + `dropTiming`).
 *
 * fixed (default, PCA): always use the season-end target N - dropCount —
 * mid-season nothing drops until a driver has more scores than that target.
 * proportional (RMsolo): drops accrue with season progress — at completed C
 * of N events, floor(C × dropCount/N) scores drop, so a half-run 10-event,
 * four-drop season counts best 3 of 5 ("half the season, half the drops"),
 * converging on exactly best-6-of-10 at season end.
 */
export function countedEventTarget(
  totalEvents: number,
  dropCount: number,
  completedEvents: number,
  timing: "fixed" | "proportional",
): number {
  const seasonEndTarget = finalCountedEventTarget(totalEvents, dropCount);
  if (timing === "fixed" || totalEvents === 0) return seasonEndTarget;
  const dropsNow = Math.floor((completedEvents * dropCount) / totalEvents);
  return Math.max(completedEvents === 0 ? 0 : 1, completedEvents - dropsNow);
}

export function finalCountedEventTarget(totalEvents: number, dropCount: number): number {
  return totalEvents === 0 ? 0 : Math.max(1, totalEvents - dropCount);
}

/**
 * Derive the season's scoring basis: total is the greater of planned and
 * completed scoring groups, while championship eligibility comes directly
 * from Season.minimumEvents. A completely empty/unplanned season reports a
 * zero threshold until it has a meaningful season size.
 */
export function seasonScoringBasis(
  year: number,
  actualGroupCount: number,
  planned: Record<number, number>,
  minimumEvents: number,
): { totalEvents: number; completedEvents: number; qualifyingEvents: number } {
  const totalEvents = Math.max(planned[year] ?? 0, actualGroupCount);
  return {
    totalEvents,
    completedEvents: actualGroupCount,
    qualifyingEvents: totalEvents === 0 ? 0 : minimumEvents,
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
  averagePoints: number; // totalPoints / counted scores (championship average; dropped scores excluded), 1dp
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
  finalCountedEvents: number; // season-end best-N target: totalEvents - ruleset dropCount, clamped to at least one
  countedEvents: number; // scores counted right now; equals finalCountedEvents in fixed timing, scales with progress in proportional timing
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
  // `paxIndexApplied` (PR 3, Task 10) is the snapshot actually scored with —
  // see `appliedPaxIndex` — `paxClass.paxIndex` is read only as its fallback.
  paxClass: { paxIndex: unknown };
  paxIndexApplied: unknown;
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
 * Return every year with a Season row under a league, sorted descending
 * (most recent first). Powers the season switcher. Season-driven, not event
 * dates — a league with no Season rows yet returns `[]`.
 *
 * Two forms: `listSeasonYears(client?)` (legacy/default path — the
 * deployment's default league, byte-identical to pre-Task-4 behavior) and
 * `listSeasonYears(leagueId, client?)` (explicit target, for league-scoped
 * routes/tests).
 */
export async function listSeasonYears(client?: PrismaClient): Promise<number[]>;
export async function listSeasonYears(
  leagueId: number,
  client?: PrismaClient,
): Promise<number[]>;
export async function listSeasonYears(
  leagueIdOrClient?: number | PrismaClient,
  clientArg: PrismaClient = defaultClient,
): Promise<number[]> {
  let leagueId: number | null;
  let client: PrismaClient;
  if (typeof leagueIdOrClient === "number") {
    leagueId = leagueIdOrClient;
    client = clientArg;
  } else {
    client = leagueIdOrClient ?? defaultClient;
    leagueId = await resolveDefaultLeagueId(client);
  }
  if (leagueId == null) return [];
  const seasons = await client.season.findMany({
    where: { leagueId },
    select: { year: true },
  });
  const years = Array.from(new Set(seasons.map((s) => s.year)));
  return years.sort((a, b) => b - a);
}

const seasonLeaderboardInclude = {
  ruleset: { select: { policy: true } },
  events: {
    orderBy: { date: "asc" as const },
    include: {
      entries: {
        select: {
          bestCommittedRunNumber: true,
          paxIndexApplied: true,
          // Scalar ids, not `class`/`paxClass` relations: both point at the same
          // table, so including them costs two round trips. `hydrateEntries`
          // below resolves them through one shared CarClass lookup.
          classId: true,
          paxClassId: true,
          driver: { select: { id: true, firstName: true, lastInitial: true } },
          runs: { select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true } },
        },
      },
    },
  },
} satisfies Prisma.SeasonInclude;

/**
 * Resolve the Season row (with its full events/entries include) addressed
 * by `target`: a bare `year` (legacy/default-league path — id-asc tiebreak,
 * matching pre-Task-4 behavior exactly), `{ seasonId }` (direct address), or
 * `{ leagueId, year }` (explicit league, same id-asc tiebreak as the legacy
 * path). Returns `null` when the target doesn't resolve to a season (unknown
 * default league, or no season for that league/year).
 */
async function resolveLeaderboardSeason(
  target: number | { seasonId: number } | { leagueId: number; year: number },
  client: PrismaClient,
) {
  if (typeof target === "number") {
    const leagueId = await resolveDefaultLeagueId(client);
    if (leagueId == null) return null;
    return client.season.findFirst({
      where: { leagueId, year: target },
      orderBy: { id: "asc" },
      include: seasonLeaderboardInclude,
    });
  }
  if ("seasonId" in target) {
    return client.season.findUnique({
      where: { id: target.seasonId },
      include: seasonLeaderboardInclude,
    });
  }
  return client.season.findFirst({
    where: { leagueId: target.leagueId, year: target.year },
    orderBy: { id: "asc" },
    include: seasonLeaderboardInclude,
  });
}

type RawSeason = NonNullable<Awaited<ReturnType<typeof resolveLeaderboardSeason>>>;

/**
 * Attach each entry's CarClass rows from one shared lookup, restoring the
 * `class`/`paxClass` shape the scoring code below expects. Splitting this out of
 * the query is what turns two CarClass round trips into one — see
 * `loadCarClassMap`.
 */
async function hydrateEvents(
  raw: RawSeason["events"],
  client: PrismaClient,
): Promise<LoadedEvent[]> {
  const classMap = await loadCarClassMap(
    client,
    raw.flatMap((event) => event.entries.flatMap((e) => [e.classId, e.paxClassId])),
  );
  return raw.map((event) => ({
    id: event.id,
    slug: event.slug,
    name: event.name,
    date: event.date,
    entries: event.entries.map((e) => ({
      class: requireCarClass(classMap, e.classId),
      paxClass: requireCarClass(classMap, e.paxClassId),
      paxIndexApplied: e.paxIndexApplied,
      driver: e.driver,
      bestCommittedRunNumber: e.bestCommittedRunNumber,
      runs: e.runs,
    })),
  }));
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
 * League Foundation: events are scoped to a Season row rather than a raw
 * date range. Planned and minimum qualifying event counts come from Season;
 * drop count/timing, synthetic PAX, and cone penalties come from its live
 * RULESET reference (`season.ruleset.policy`, parsed via
 * `parseScoringPolicy`). A year/target with no matching
 * Season row returns the original empty-year shape (all zero, no sections)
 * — same as a season with a Season row but zero ingested events, except
 * `totalEvents` there reflects the Season's planned count instead of 0.
 *
 * Cone-penalty threading (League Foundation PR 2 Task 7):
 * The ruleset policy's `conePenaltyMs` is passed to `bestCorrectedMsForEntry` below,
 * so a season configured with a non-default value (e.g. an RMsolo season
 * using a different per-cone penalty) actually scores with it — the same
 * value flows from `parseScoringPolicy` end-to-end. Event and combined pages
 * (`leaderboard.ts`, `combined-event.ts`) independently pass their own
 * event's season policy value into `buildLeaderboard`/`buildCombinedResults`,
 * so per-run cone math is consistent everywhere a given season's data is
 * displayed or scored. Every seeded policy today is 2000 (`CONE_PENALTY_MS`),
 * so parity holds: default seasons render byte-identically to before this
 * threading existed.
 *
 * Points systems (ScoringPolicy v4): the per-event formula is ruleset policy,
 * not a constant. `points.basis: "class"` scores each section against its own
 * fastest (PCA — every class winner earns the maximum); `points.basis:
 * "event"` scores every driver against the event's fastest indexed time, so a
 * driver earns exactly ONE score per group, reused in their class section and
 * in the synthetic PAX section (RMsolo's published rule). `points.type`
 * chooses the arithmetic — a 1000-ratio or a finish-position table — and lives
 * in `event-points.ts`'s `awardPoints`. Section MEMBERSHIP is unchanged by any
 * of this: only the points value differs.
 *
 * Task 4 — explicit league/season targets: two overloads.
 * `buildSeasonLeaderboard(year, client?)` is the legacy/default path (the
 * deployment's default league, by year — byte-identical to pre-Task-4
 * behavior, including the id-asc season tiebreak). `buildSeasonLeaderboard({
 * seasonId } | { leagueId, year }, client?)` addresses a specific season
 * directly, for league-scoped routes/tests.
 */
export async function buildSeasonLeaderboard(
  year: number,
  client?: PrismaClient,
): Promise<SeasonLeaderboardResult>;
export async function buildSeasonLeaderboard(
  target: { seasonId: number } | { leagueId: number; year: number },
  client?: PrismaClient,
): Promise<SeasonLeaderboardResult>;
export async function buildSeasonLeaderboard(
  target: number | { seasonId: number } | { leagueId: number; year: number },
  client: PrismaClient = defaultClient,
): Promise<SeasonLeaderboardResult> {
  const season = await resolveLeaderboardSeason(target, client);

  if (season == null) {
    return {
      totalEvents: 0,
      completedEvents: 0,
      qualifyingEvents: 0,
      finalCountedEvents: 0,
      countedEvents: 0,
      sections: [],
    };
  }

  const year = season.year;
  const policy = parseScoringPolicy(season.ruleset.policy);

  // 1. Events for the season, already loaded in chronological order.
  const events: LoadedEvent[] = await hydrateEvents(season.events, client);
  const plannedEvents: Record<number, number> = { [year]: season.plannedEvents };

  if (events.length === 0) {
    const basis = seasonScoringBasis(year, 0, plannedEvents, season.minimumEvents);
    const finalCountedEvents = finalCountedEventTarget(basis.totalEvents, policy.dropCount);
    const countedEvents = countedEventTarget(
      basis.totalEvents,
      policy.dropCount,
      0,
      policy.dropTiming,
    );
    return { ...basis, finalCountedEvents, countedEvents, sections: [] };
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
      `[season-leaderboard] season ${year}: a real class named '${PAX_SECTION_CODE}' exists — skipping the synthetic overall-PAX section (ruleset policy paxSection=true)`,
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
  // Per (event, driver) best indexed metric across ALL of that driver's
  // entries — the population a `points.basis: "event"` ruleset scores
  // against. Built unconditionally rather than gated on `paxSection`, because
  // event basis needs it even when the synthetic section is switched off.
  const indexedByEventDriver = new Map<number, Map<number, number>>();

  for (const event of events) {
    const byClass = new Map<string, Map<number, number>>();
    const indexedByDriver = new Map<number, number>();
    for (const entry of event.entries) {
      const d = entry.driver;
      if (!driverInfo.has(d.id)) {
        driverInfo.set(d.id, { firstName: d.firstName, lastInitial: d.lastInitial });
      }

      const best = bestCorrectedMsForEntry(entry, policy.conePenaltyMs);
      if (best == null) continue; // no CLEAN run or committed best — excluded from event scoring

      const code = entry.class.code;
      let byDriver = byClass.get(code);
      if (byDriver == null) {
        byDriver = new Map();
        byClass.set(code, byDriver);
      }
      // Class ranking metric: every class ranks on the PAX-indexed best time
      // — a pure rescale (identical order and points) for classes whose
      // entries share one factor, and the official ordering for run-group
      // classes whose entries carry per-driver derived factors (the printed
      // group results are indexed). (scoring-policy.ts v2 dropped the old
      // per-policy raw/pax ranking toggle — this is unconditional now.)
      // Keep the indexed metric at full precision until the final points
      // calculation. Rounding here can change points at a half-point boundary
      // even when every entry in the class has the same PAX factor, violating
      // the pure-rescale property described above.
      const rankMetric = best * appliedPaxIndex(entry);
      const existing = byDriver.get(d.id);
      if (existing == null || rankMetric < existing) {
        byDriver.set(d.id, rankMetric);
      }

      const existingIndexed = indexedByDriver.get(d.id);
      if (existingIndexed == null || rankMetric < existingIndexed) {
        indexedByDriver.set(d.id, rankMetric);
      }
    }
    // Synthetic overall-PAX section (ruleset policy paxSection=true): the same
    // event-wide indexed metric, exposed as one more class so that points,
    // combined groups, qualifying thresholds, and drops all treat it
    // identically. It shares the class metric's full precision — a
    // `points.basis: "event"` ruleset requires a driver's class score and PAX
    // score to be the same number, which only holds if both are computed from
    // the same unrounded value.
    if (paxSectionEnabled) {
      byClass.set(PAX_SECTION_CODE, new Map(indexedByDriver));
    }
    bestByEventClassDriver.set(event.id, byClass);
    indexedByEventDriver.set(event.id, indexedByDriver);
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
    season.minimumEvents,
  );
  const finalCountedEvents = finalCountedEventTarget(totalEvents, policy.dropCount);
  const countedEvents = countedEventTarget(
    totalEvents,
    policy.dropCount,
    completedEvents,
    policy.dropTiming,
  );

  // 4. Score each scoring group. A group is one or more sessions sharing a
  //    calendar date. A driver scores in a class only when they have a
  //    countable time in that class in EVERY session of the group, and the
  //    group's metric is the sum of those per-session metrics. A single-
  //    session group is the degenerate case of that same rule (a sum of one),
  //    so both shapes run one path — which is what keeps points dispatch in
  //    exactly one place instead of two that can drift apart.
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

  /**
   * Sum one per-session metric map across every session in the group, keeping
   * only drivers present in ALL of them. Missing a session — or racing a
   * different class in another session, which means no entry under this class
   * code there — excludes a driver, with no special-case code.
   *
   * Serves both the per-class maps and the event-wide map.
   */
  const sumAcrossGroup = (
    group: LoadedEvent[],
    metricFor: (eventId: number) => Map<number, number> | undefined,
  ): Map<number, number> => {
    const summed = new Map<number, number>();
    const firstSession = metricFor(group[0]!.id);
    if (firstSession == null) return summed;
    for (const driverId of firstSession.keys()) {
      let total = 0;
      let presentInAll = true;
      for (const event of group) {
        const value = metricFor(event.id)?.get(driverId);
        if (value == null) {
          presentInAll = false;
          break;
        }
        total += value;
      }
      if (presentInAll) summed.set(driverId, total);
    }
    return summed;
  };

  for (const [dateKey, group] of scoringGroups) {
    const single = group.length === 1 ? group[0]! : null;
    const key = single == null ? `combined-${dateKey}` : single.slug;
    const eventName = single == null ? combinedEventLabel(group) : single.name;
    const eventDate = group[0]!.date;
    const href = single == null ? `/events/combined/${dateKey}` : `/events/${single.slug}`;
    const combined = single == null;

    // Union of class codes seen across the group's sessions.
    const classCodes = new Set<string>();
    for (const event of group) {
      for (const classCode of bestByEventClassDriver.get(event.id)!.keys()) {
        classCodes.add(classCode);
      }
    }

    // basis "event": one score per driver for the whole group, computed once
    // against every driver at the event regardless of class, then reused in
    // each of that driver's sections. This is RMsolo's published rule.
    const eventPoints =
      policy.points.basis === "event"
        ? awardPoints(
            sumAcrossGroup(group, (eventId) => indexedByEventDriver.get(eventId)),
            policy.points,
          )
        : null;

    for (const classCode of classCodes) {
      const classMetrics = sumAcrossGroup(group, (eventId) =>
        bestByEventClassDriver.get(eventId)!.get(classCode),
      );
      if (classMetrics.size === 0) continue;

      // basis "class": score against this section's own population.
      const sectionPoints = eventPoints ?? awardPoints(classMetrics, policy.points);

      for (const driverId of classMetrics.keys()) {
        const points = sectionPoints.get(driverId);
        // Total by construction under either basis: qualifying for a class in
        // every session implies having an indexed time in every session, so
        // the event-wide map is a superset of every class map. Skip rather
        // than emit a wrong score if that ever stops holding.
        if (points == null) {
          console.warn(
            `[season-leaderboard] season ${year}: driver ${driverId} in class '${classCode}' scoring group '${key}' has no points in the event-wide map — skipping (should be impossible)`,
          );
          continue;
        }
        pushScore(driverId, classCode, {
          key,
          eventName,
          eventDate,
          points,
          combined,
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
    // Ruleset dropTiming="proportional" scales the counted target with season
    // progress (see countedEventTarget); "fixed" uses the final N-dropCount
    // target throughout.
    const sorted = [...rawScores].sort((a, b) => b.points - a.points);
    const counted = sorted.slice(0, countedEvents);
    const totalPoints = counted.reduce((sum, s) => sum + s.points, 0);
    // Championship average: counted scores only (BJ, 2026-07-23) — a dropped
    // score never dilutes it. Mirrors the club sheet's per-event pace metric
    // but over the counted set, matching what totalPoints is built from.
    const averagePoints =
      counted.length === 0 ? 0 : Math.round((totalPoints / counted.length) * 10) / 10;
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
      averagePoints,
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
  return {
    totalEvents,
    completedEvents,
    qualifyingEvents,
    finalCountedEvents,
    countedEvents,
    sections,
  };
}

export type SeasonClassSummary = {
  classCode: string;
  driverCount: number;
  leader: { driverId: number; driverName: string; totalPoints: number } | null;
};

export function summarizeSeasonSections(
  sections: SeasonStandingsByClass[],
): SeasonClassSummary[] {
  return sections
    .filter((section) => section.drivers.length > 0)
    .map((section) => {
      const leader = section.drivers[0];
      return {
        classCode: section.classCode,
        driverCount: section.drivers.length,
        leader:
          leader == null
            ? null
            : {
                driverId: leader.driverId,
                driverName: leader.driverName,
                totalPoints: leader.totalPoints,
              },
      };
    });
}

export function findSeasonSection(
  sections: SeasonStandingsByClass[],
  classParam: string,
): SeasonStandingsByClass | null {
  const wanted = classParam.trim().toLowerCase();
  if (wanted.length === 0) return null;
  return (
    sections.find((section) => section.classCode.toLowerCase() === wanted) ??
    null
  );
}
