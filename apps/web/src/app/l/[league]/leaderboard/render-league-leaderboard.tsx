import { buildSeasonLeaderboard } from "@/lib/season-leaderboard";
import { listSeasonsForLeague } from "@/lib/season-resolve";
import { prisma } from "@/lib/prisma";
import { SeasonLeaderboardView } from "@/app/leaderboard/season-leaderboard-view";
import { LeagueSeasonSwitcher } from "./league-season-switcher";

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
  leagueId,
  leagueName,
  leagueSlug,
  season,
}: {
  leagueId: number;
  leagueName: string;
  leagueSlug: string;
  season: { id: number; slug: string; name: string } | null;
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

  const seasons = await listSeasonsForLeague(prisma, leagueId);
  const result = await buildSeasonLeaderboard({ seasonId: season.id }, prisma);

  return (
    <SeasonLeaderboardView
      title={`${season.name} Leaderboard`}
      switcher={
        seasons.length > 1 ? (
          <div className="sm:shrink-0 sm:ml-4">
            <LeagueSeasonSwitcher
              seasons={seasons}
              currentSlug={season.slug}
              basePath={`/l/${leagueSlug}/leaderboard/s`}
            />
          </div>
        ) : null
      }
      periodLabel={season.name}
      standings={result.sections}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
