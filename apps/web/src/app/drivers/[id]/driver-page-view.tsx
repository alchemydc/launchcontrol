import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import {
  buildDriverHistory,
  listSeasonsForDriver,
  type DriverHistoryFilter,
  type DriverHistoryRow,
} from "@/lib/driver-history";
import { getLeagueConfig, getLeagueConfigForSlug } from "@/lib/league-config";
import { ProgressionChart, type ProgressionPoint } from "./progression-chart";
import { TimeDeltaChart } from "./time-delta-chart";
import { BackButton } from "@/components/back-button";
import { classingHintsByKey } from "@/lib/classing-registry";
import { EventHistory } from "./event-history";
import { DriverFilterBar } from "./driver-filter-bar";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function toChartData(rows: DriverHistoryRow[]): ProgressionPoint[] {
  return rows.map((row) => ({
    date: row.eventDate.toISOString(),
    label: formatDate(row.eventDate),
    eventName: row.eventName,
    position: row.position,
    percentile: row.percentile,
    diffFromLeaderPct: row.diffFromLeaderPct,
    diffFromMedianPct: row.diffFromMedianPct,
  }));
}

type TimeScope = "all" | "season" | "range";

type CurrentSelection = {
  league: "all" | string;
  timeScope: TimeScope;
  seasonId?: number;
  from?: string;
  to?: string;
};

/**
 * URL query params -> DriverHistoryFilter + the UI's current-selection state.
 * No `league`/`season`/`from`/`to` params at all yields `filter = {}`, which
 * `buildDriverHistory` resolves to the legacy default-league/all-time scope
 * -- the Task 6 parity contract (default view on a single-league DB renders
 * the same event set as before this task).
 *
 * An unrecognized `league` slug (stale bookmark, typo) is silently ignored
 * rather than 404ing -- falls back to the same default-league scope as no
 * param at all.
 *
 * Edge case: a driver whose ONLY league is a non-default one would
 * otherwise render an empty page on the bare `/drivers/[id]` URL (the
 * legacy default-league scope resolves to zero events for them) with no
 * league chips to escape it (chips only render for >1 league, per spec).
 * When no league/time params are present at all AND the driver has no
 * footprint in the deployment's default league, fall back to "all leagues"
 * instead of the bare legacy scope. This never fires on a single-league DB
 * (every driver's one league IS the default there), so it doesn't affect
 * the Task 6 parity contract.
 *
 * `locked` (Task 20, `/l/[league]/drivers/[id]`): the league filter is
 * pinned to `defaultLeague` (here, the route's own league) and every
 * `?league=` param plus the no-footprint fallback above are ignored --
 * the viewer can never leave that league's scope from this page. A
 * `?season=` naming a season from a DIFFERENT league is likewise dropped
 * (falls back to the locked league's default all-time scope) rather than
 * honored -- `seasonId` wins over `leagueIds` in driver-history.ts's
 * `resolveScope`, so an unvalidated cross-league season id would otherwise
 * escape the lock entirely. Validated against `seasons` (the driver's own
 * season breadth, same list the season chips render from), mirroring how a
 * conflicting `?league=` is ignored using that same driver-scoped list.
 */
export function parseFilter(
  searchParams: { league?: string; season?: string; from?: string; to?: string },
  leagues: Array<{ id: number; slug: string }>,
  seasons: Array<{ seasonId: number; leagueId: number }>,
  defaultLeague: { id: number; slug: string },
  locked: boolean,
): { filter: DriverHistoryFilter; current: CurrentSelection } {
  const filter: DriverHistoryFilter = {};
  let league: "all" | string = defaultLeague.slug;

  if (locked) {
    filter.leagueIds = [defaultLeague.id];
  } else {
    const noParamsGiven =
      !searchParams.league && !searchParams.season && !searchParams.from && !searchParams.to;
    const driverHasNoDefaultLeagueFootprint =
      leagues.length > 0 && !leagues.some((l) => l.id === defaultLeague.id);

    if (searchParams.league === "all") {
      filter.leagueIds = "all";
      league = "all";
    } else if (searchParams.league) {
      const match = leagues.find((l) => l.slug === searchParams.league);
      if (match) {
        filter.leagueIds = [match.id];
        league = match.slug;
      }
    } else if (noParamsGiven && driverHasNoDefaultLeagueFootprint) {
      filter.leagueIds = "all";
      league = "all";
    }
  }

  let timeScope: TimeScope = "all";
  let seasonId: number | undefined;
  let from: string | undefined;
  let to: string | undefined;

  const seasonIdNum = searchParams.season ? Number(searchParams.season) : NaN;
  const seasonRequested = Number.isInteger(seasonIdNum) && seasonIdNum > 0;
  // Locked pages only honor a `?season=` that resolves to a season within
  // the locked league itself -- see the doc comment above.
  const seasonAllowed =
    seasonRequested &&
    (!locked || seasons.some((s) => s.seasonId === seasonIdNum && s.leagueId === defaultLeague.id));
  if (seasonAllowed) {
    filter.seasonId = seasonIdNum;
    timeScope = "season";
    seasonId = seasonIdNum;
  } else if (searchParams.from || searchParams.to) {
    timeScope = "range";
    if (searchParams.from) {
      const d = new Date(`${searchParams.from}T00:00:00.000Z`);
      if (!Number.isNaN(d.getTime())) {
        filter.from = d;
        from = searchParams.from;
      }
    }
    if (searchParams.to) {
      const d = new Date(`${searchParams.to}T23:59:59.999Z`);
      if (!Number.isNaN(d.getTime())) {
        filter.to = d;
        to = searchParams.to;
      }
    }
  }

  return { filter, current: { league, timeScope, seasonId, from, to } };
}

/**
 * Shared driver-detail body (Task 20) -- extracted from the legacy
 * `/drivers/[id]` page so both it and `/l/[league]/drivers/[id]` render the
 * exact same JSX from one place instead of forking it. Callers resolve and
 * gate (requireRmrMember / requireMember) themselves before calling this --
 * the gate must run before this component's `notFound()` so unauth viewers
 * can't probe driver id existence via 404 vs redirect behavior -- and
 * validate `driverId` from the route param first.
 */
export async function DriverPageView({
  driverId,
  lockedLeagueSlug,
  basePath,
  searchParams: rawSearchParams,
}: {
  driverId: number;
  /** Set on `/l/[league]/drivers/[id]` (Task 20): pins the filter bar's
   *  league scope to this slug and hides its league chips. The caller has
   *  already resolved this slug to a real league (404ing otherwise), so
   *  `getLeagueConfigForSlug` here is expected to always resolve. */
  lockedLeagueSlug?: string;
  /** "" for the legacy route (byte-identical to pre-Task-20 rendering),
   *  "/l/[slug]" for league-scoped. */
  basePath: string;
  searchParams: { league?: string; season?: string; from?: string; to?: string };
}) {
  // These three reads don't depend on each other, so they issue together
  // rather than in series. Against Turso each is a network round trip, and
  // this page is both the most-requested route and force-dynamic, so the
  // depth of the serial chain -- not the query count -- is what costs here.
  // `notFound()` stays outside: it throws NEXT_REDIRECT-style control flow,
  // which must not reject the Promise.all.
  const [driver, driverSeasons, lockedLeague] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    // The driver's full league/season breadth, independent of the current
    // filter selection -- powers the filter bar's options.
    listSeasonsForDriver(driverId, prisma),
    lockedLeagueSlug ? getLeagueConfigForSlug(lockedLeagueSlug) : Promise.resolve(null),
  ]);
  if (!driver) notFound();

  const leagues = Array.from(
    new Map(driverSeasons.map((s) => [s.leagueId, { id: s.leagueId, slug: s.leagueSlug, name: s.leagueName }])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Only the legacy (non-league-scoped) route reaches this second await:
  // `/l/[league]/drivers/[id]` already resolved its league above.
  const defaultLeague = lockedLeague ?? (await getLeagueConfig());
  const { filter, current } = parseFilter(
    rawSearchParams,
    leagues,
    driverSeasons,
    defaultLeague,
    lockedLeague != null,
  );

  const history = await buildDriverHistory(driverId, filter, prisma);
  const driverName = `${driver.firstName} ${driver.lastInitial}`;

  const cleanRows = history.filter((r) => r.position != null);
  const bestPosition =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.position as number));
  const bestPercentile =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.percentile as number));
  const avgPosition =
    cleanRows.length === 0
      ? null
      : cleanRows.reduce((sum, r) => sum + (r.position as number), 0) /
        cleanRows.length;
  const avgPercentile =
    cleanRows.length === 0
      ? null
      : cleanRows.reduce((sum, r) => sum + (r.percentile as number), 0) /
        cleanRows.length;

  // Cross-league aggregation rule (spec §5): the summary counts/positions
  // above combine across leagues freely. Time-series charts do not -- a
  // shared x-axis position/percentile line spanning two leagues' distinct
  // fields would be meaningless, so each league gets its own chart pair
  // when the filtered set actually spans more than one.
  const distinctLeagueIds = Array.from(new Set(history.map((r) => r.leagueId)));
  const chartSections =
    distinctLeagueIds.length > 1
      ? distinctLeagueIds.map((leagueId) => {
          const rows = history.filter((r) => r.leagueId === leagueId);
          return { leagueName: rows[0]!.leagueName, data: toChartData(rows) };
        })
      : distinctLeagueIds.length === 1
        ? [{ leagueName: null, data: toChartData(history) }]
        : [];

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref={basePath ? `${basePath}/leaderboard` : "/leaderboard"} />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Driver · {driverId}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {driverName}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 sm:ml-4">
            <Badge variant="default">
              {history.length} {history.length === 1 ? "event" : "events"}
            </Badge>
          </div>
        </div>
      </header>

      <DriverFilterBar
        driverId={driverId}
        leagues={leagues.map((l) => ({ slug: l.slug, name: l.name }))}
        seasons={driverSeasons.map((s) => ({
          seasonId: s.seasonId,
          seasonName: s.seasonName,
          year: s.year,
          leagueSlug: s.leagueSlug,
          leagueName: s.leagueName,
        }))}
        current={current}
        basePath={basePath}
        lockedLeagueSlug={lockedLeagueSlug}
      />

      <div className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
            Summary
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 p-4">
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Events
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {history.length}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Best finish
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {bestPosition ?? "—"}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Avg finish
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {avgPosition == null ? "—" : avgPosition.toFixed(1)}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Best percentile
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(bestPercentile)}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Avg percentile
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(avgPercentile)}
            </div>
          </div>
        </div>
      </div>

      {chartSections.map((section, i) => (
        <div key={section.leagueName ?? i}>
          {section.leagueName && (
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.leagueName}
            </h3>
          )}
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
            <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
                Progression
              </h2>
            </div>
            <div className="p-4">
              <ProgressionChart data={section.data} />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
            <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
                Time differential
              </h2>
            </div>
            <div className="p-4">
              <TimeDeltaChart data={section.data} />
            </div>
          </div>
        </div>
      ))}

      {/* defaultLeagueSlug: on the legacy (basePath="") page `defaultLeague`
          IS the deployment default; on locked pages it's the locked league,
          but there basePath is non-empty and the slug goes unused. */}
      <EventHistory
        history={history}
        basePath={basePath}
        defaultLeagueSlug={defaultLeague.slug}
        classing={classingHintsByKey(history, (leagueSlug) =>
          // Mirrors historyRowEventHref's link base: on the locked page every
          // row is in-league and uses that prefix; on the legacy page rows can
          // span leagues, and only the default league's are served unprefixed.
          basePath || (leagueSlug === defaultLeague.slug ? "" : `/l/${leagueSlug}`),
        )}
      />
    </main>
  );
}
