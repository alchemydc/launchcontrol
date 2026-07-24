import {
  buildSeasonLeaderboard,
  listSeasonYears,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { SeasonOverviewView } from "./season-overview-view";
import { gateResultsPage } from "@/lib/session";

// ISR: rendered on demand, then cached for 5 minutes. Gated deployments
// (ACCESS_GATE=required) read cookies inside gateResultsPage and render
// per-request instead.
export const revalidate = 300;

export default async function LeaderboardPage() {
  await gateResultsPage("/leaderboard");

  const years = await listSeasonYears();
  const currentYear = years[0] ?? new Date().getUTCFullYear();
  const result = await buildSeasonLeaderboard(currentYear);

  return (
    <SeasonOverviewView
      year={currentYear}
      years={years}
      summaries={summarizeSeasonSections(result.sections)}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
