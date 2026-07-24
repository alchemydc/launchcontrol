import {
  buildSeasonLeaderboard,
  listSeasonYears,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { SeasonSwitcher } from "./season-switcher";
import { SeasonOverviewView } from "./season-overview-view";

export const revalidate = 300;

export default async function LeaderboardPage() {
  const league = await getLeagueConfig();
  await gateResultsPage(league, "/leaderboard", `/l/${league.slug}`);

  const years = await listSeasonYears();
  const currentYear = years[0] ?? new Date().getUTCFullYear();
  const result = await buildSeasonLeaderboard(currentYear);

  return (
    <>
      <DefaultLeagueSubnav />
      <SeasonOverviewView
        title={`${currentYear} Season Leaderboard`}
        switcher={
          years.length > 1 ? (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={currentYear} />
            </div>
          ) : null
        }
        periodLabel={String(currentYear)}
        classBasePath={`/leaderboard/${currentYear}`}
        summaries={summarizeSeasonSections(result.sections)}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        countedEvents={result.countedEvents}
      />
    </>
  );
}
