import { buildSeasonLeaderboard, listSeasonYears } from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "./season-leaderboard-view";
import { SeasonSwitcher } from "./season-switcher";
import { requireRmrMember } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; sort?: string }>;
}) {
  await requireRmrMember("/leaderboard");
  const { class: activeClassCode, sort } = await searchParams;

  const years = await listSeasonYears();
  const currentYear = years[0] ?? new Date().getUTCFullYear();
  const result = await buildSeasonLeaderboard(currentYear);

  return (
    <>
      <DefaultLeagueSubnav />
      <SeasonLeaderboardView
        title={`${currentYear} Season Leaderboard`}
        activeClassCode={activeClassCode}
        sortBy={sort}
        switcher={
          years.length > 1 ? (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={currentYear} />
            </div>
          ) : null
        }
        periodLabel={String(currentYear)}
        standings={result.sections}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        countedEvents={result.countedEvents}
      />
    </>
  );
}
