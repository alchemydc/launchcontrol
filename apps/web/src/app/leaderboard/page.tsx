import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "./season-leaderboard-view";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const years = await listSeasonYears();
  const currentYear = years[0] ?? new Date().getFullYear();
  const standings = await buildSeasonLeaderboard(currentYear);

  return (
    <SeasonLeaderboardView
      year={currentYear}
      years={years}
      standings={standings}
    />
  );
}
