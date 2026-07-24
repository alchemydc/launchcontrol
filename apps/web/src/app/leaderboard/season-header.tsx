import { SeasonSwitcher } from "./season-switcher";

// Scoring-rule copy that stays truthful in both SEASON_DROPS modes: in fixed
// mode countedEvents === qualifyingEvents, reproducing the original sentence
// byte-for-byte; in proportional mode mid-season it states the current
// counted target and the season-end rule.
export function scoringNote(
  countedEvents: number,
  qualifyingEvents: number,
  totalEvents: number,
): string {
  if (countedEvents === qualifyingEvents) {
    return `Best ${qualifyingEvents} of ${totalEvents} scores count toward the season total.`;
  }
  return `Best ${countedEvents} scores currently count toward the season total (best ${qualifyingEvents} of ${totalEvents} at season end).`;
}

/**
 * Shared header for the season overview and per-class pages: title, scoring
 * copy, year switcher, and the provisional-standings banner.
 */
export function SeasonHeader({
  year,
  years,
  totalEvents,
  completedEvents,
  qualifyingEvents,
  countedEvents,
  hasStandings,
}: {
  year: number;
  years: number[];
  totalEvents: number;
  completedEvents: number;
  qualifyingEvents: number;
  countedEvents: number;
  hasStandings: boolean;
}) {
  return (
    <>
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          Season standings
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {year} Season Leaderboard
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Points are awarded per event: 1000 to the class winner, others
                proportional. Combined (same-date, multi-session) events score
                once, on summed session times.{" "}
                {scoringNote(countedEvents, qualifyingEvents, totalEvents)}{" "}
                Drivers with fewer than {qualifyingEvents} scoring events are
                marked Provisional.
              </p>
            </div>
          </div>
          {years.length > 1 && (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={year} />
            </div>
          )}
        </div>
      </header>

      {completedEvents < qualifyingEvents && hasStandings && (
        <div className="mb-6 flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">
            Standings are provisional until {qualifyingEvents} of {totalEvents}{" "}
            events are complete ({completedEvents} run so far).
          </p>
        </div>
      )}
    </>
  );
}
