import { notFound } from "next/navigation";
import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "../season-leaderboard-view";
import { SeasonSwitcher } from "../season-switcher";
import { requireRmrMember } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";

export const dynamic = "force-dynamic";

export default async function LeaderboardYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ class?: string; sort?: string }>;
}) {
  const { year: yearStr } = await params;
  const { class: activeClassCode, sort } = await searchParams;

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
    <>
      <DefaultLeagueSubnav />
      <SeasonLeaderboardView
        title={`${year} Season Leaderboard`}
        activeClassCode={activeClassCode}
        sortBy={sort}
        switcher={
          years.length > 1 ? (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={year} />
            </div>
          ) : null
        }
        periodLabel={String(year)}
        standings={result.sections}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        countedEvents={result.countedEvents}
      />
    </>
  );
}
