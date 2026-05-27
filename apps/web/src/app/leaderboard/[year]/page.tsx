import { notFound } from "next/navigation";
import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "../season-leaderboard-view";

export const dynamic = "force-dynamic";

export default async function LeaderboardYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearStr } = await params;
  const year = Number(yearStr);

  // Validate: must be a finite integer in a sensible calendar range
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    notFound();
  }

  const years = await listSeasonYears();
  const result = await buildSeasonLeaderboard(year);

  return (
    <SeasonLeaderboardView
      year={year}
      years={years}
      standings={result.sections}
      totalEvents={result.totalEvents}
      qualifyingEvents={result.qualifyingEvents}
    />
  );
}
