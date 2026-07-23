import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import { prisma } from "@/lib/prisma";
import { SeasonLeaderboardView } from "@/app/leaderboard/season-leaderboard-view";

/**
 * Shared render body for both /l/[league]/leaderboard (bare — active season)
 * and /l/[league]/leaderboard/s/[seasonSlug] (Task 5), so both address the
 * same season-standings view through one place. `season: null` renders the
 * same graceful empty state the legacy /leaderboard page does for a league
 * with no season data yet (an unknown league or unknown SEASON SLUG is a
 * 404, handled by the caller before this runs — a league with zero seasons
 * is not).
 */
export async function renderLeagueSeasonLeaderboard({
  leagueName,
  season,
  activeClassCode,
  sortBy,
}: {
  leagueName: string;
  season: { id: number; slug: string; name: string } | null;
  activeClassCode?: string | null;
  sortBy?: string | null;
}) {
  if (!season) {
    return (
      <SeasonLeaderboardView
        title={`${leagueName} Leaderboard`}
        periodLabel={leagueName}
        standings={[]}
        totalEvents={0}
        completedEvents={0}
        qualifyingEvents={0}
        countedEvents={0}
      />
    );
  }

  const result = await buildSeasonLeaderboard({ seasonId: season.id }, prisma);

  // Season navigation lives in the league subnav (layout-mounted), so no
  // in-page switcher here — one navigation surface per league page.
  return (
    <SeasonLeaderboardView
      title={`${season.name} Leaderboard`}
      periodLabel={season.name}
      activeClassCode={activeClassCode}
      sortBy={sortBy}
      standings={result.sections}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
