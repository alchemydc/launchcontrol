import { notFound } from "next/navigation";
import {
  buildSeasonLeaderboard,
  listSeasonYears,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { SeasonSwitcher } from "../season-switcher";
import { SeasonOverviewView } from "../season-overview-view";

export const revalidate = 300;

export default async function LeaderboardYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearStr } = await params;
  const league = await getLeagueConfig();
  await gateResultsPage(
    league,
    `/leaderboard/${yearStr}`,
    `/l/${league.slug}`,
  );

  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) notFound();

  const years = await listSeasonYears();
  const result = await buildSeasonLeaderboard(year);

  return (
    <>
      <DefaultLeagueSubnav />
      <SeasonOverviewView
        title={`${year} Season Leaderboard`}
        switcher={
          years.length > 1 ? (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={year} />
            </div>
          ) : null
        }
        periodLabel={String(year)}
        classBasePath={`/leaderboard/${year}`}
        summaries={summarizeSeasonSections(result.sections)}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        finalCountedEvents={result.finalCountedEvents}
        countedEvents={result.countedEvents}
      />
    </>
  );
}
