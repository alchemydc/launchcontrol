import type { ReactNode } from "react";

// Scoring-rule copy keeps score drops separate from the minimum attendance
// threshold. Fixed timing uses the season-end target throughout; proportional
// timing can use a smaller current target mid-season.
export function scoringNote(
  countedEvents: number,
  finalCountedEvents: number,
  totalEvents: number,
): string {
  if (countedEvents === finalCountedEvents) {
    return `Best ${finalCountedEvents} of ${totalEvents} scores count toward the season total.`;
  }
  return `Best ${countedEvents} scores currently count toward the season total (best ${finalCountedEvents} of ${totalEvents} at season end).`;
}

/**
 * Shared header for the season overview and per-class pages: title, scoring
 * copy, year switcher, and the provisional-standings banner.
 */
export function SeasonHeader({
  title,
  switcher,
  totalEvents,
  completedEvents,
  qualifyingEvents,
  finalCountedEvents,
  countedEvents,
  hasStandings,
}: {
  title: string;
  switcher?: ReactNode;
  totalEvents: number;
  completedEvents: number;
  qualifyingEvents: number;
  finalCountedEvents: number;
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
                {title}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Points are awarded per event: 1000 to the class winner, others
                proportional. Combined (same-date, multi-session) events score
                once, on summed session times.{" "}
                {scoringNote(countedEvents, finalCountedEvents, totalEvents)}{" "}
                Drivers with fewer than {qualifyingEvents} scoring events are
                marked Provisional.
              </p>
            </div>
          </div>
          {switcher}
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
