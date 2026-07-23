import { notFound } from "next/navigation";
import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "../season-leaderboard-view";
import { requireRmrMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeaderboardYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearStr } = await params;

  // Gate runs before the year range check so unauth viewers can't probe valid vs invalid years.
  await requireRmrMember(`/leaderboard/${yearStr}`);

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
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
