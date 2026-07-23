import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "./season-leaderboard-view";
import { requireRmrMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  await requireRmrMember("/leaderboard");

  const years = await listSeasonYears();
  const currentYear = years[0] ?? new Date().getUTCFullYear();
  const result = await buildSeasonLeaderboard(currentYear);

  return (
    <SeasonLeaderboardView
      year={currentYear}
      years={years}
      standings={result.sections}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
