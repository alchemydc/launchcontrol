import { Prisma, PrismaClient, type RunDisposition } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { resolveDefaultLeague } from "@/lib/league-config";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { appliedPaxIndex } from "@/lib/pax-applied";
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
          class: { select: { code: true } },
          paxClass: { select: { paxIndex: true } },
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
 * date range, and every scoring knob — drop mode, synthetic PAX section,
 * planned event count — comes from the season's RULESET policy JSON
 * (`season.ruleset.policy`, a live reference since Task R2 — parsed via
 * `parseScoringPolicy`), not env vars. A year/target with no matching
 * Season row returns the original empty-year shape (all zero, no sections)
 * — same as a season with a Season row but zero ingested events, except
 * `totalEvents` there reflects the Season's planned count instead of 0.
 *
 * Cone-penalty threading (League Foundation PR 2 Task 7):
 * `scoringPolicy.conePenaltyMs` is passed to `bestCorrectedMsForEntry` below,
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
    return { totalEvents: 0, completedEvents: 0, qualifyingEvents: 0, countedEvents: 0, sections: [] };
  }

  const year = season.year;
  const policy = parseScoringPolicy(season.ruleset.policy);

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
      const rankMetric = Math.round(best * appliedPaxIndex(entry));
      const existing = byDriver.get(d.id);
      if (existing == null || rankMetric < existing) {
        byDriver.set(d.id, rankMetric);
      }

      // Synthetic overall-PAX section (scoringPolicy.paxSection=true): index
      // the same best-corrected time by the entry's paxClass factor and rank
      // across every class. Everything downstream (points formula, combined
      // groups, qualifying threshold, drops) treats it as one more class.
      if (paxSectionEnabled) {
        const paxMs = Math.round(best * appliedPaxIndex(entry));
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
  return { totalEvents, completedEvents, qualifyingEvents, countedEvents, sections };
}
