import { notFound } from "next/navigation";
import {
  buildSeasonLeaderboard,
  findSeasonSection,
  listSeasonYears,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { getLeagueConfig } from "@/lib/league-config";
import { gateResultsPage } from "@/lib/session";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { SeasonSwitcher } from "../../season-switcher";
import { SeasonLeaderboardView } from "../../season-leaderboard-view";

export const revalidate = 300;

function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function LeaderboardClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; class: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { year: yearStr, class: rawClass } = await params;
  const { sort } = await searchParams;
  const league = await getLeagueConfig();
  await gateResultsPage(
    league,
    `/leaderboard/${yearStr}/${rawClass}`,
    `/l/${league.slug}`,
  );

  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) notFound();

  const years = await listSeasonYears();
  const result = await buildSeasonLeaderboard(year);
  const section = findSeasonSection(
    result.sections,
    decodeClassParam(rawClass),
  );
  if (section == null) notFound();
  const classBasePath = `/leaderboard/${year}`;

  return (
    <>
      <DefaultLeagueSubnav />
      <SeasonLeaderboardView
        title={`${year} Season Leaderboard`}
        switcher={
          years.length > 1 ? (
            <div className="sm:shrink-0 sm:ml-4">
              <SeasonSwitcher years={years} currentYear={year} />
            </div>
          ) : null
        }
        section={section}
        allSummaries={summarizeSeasonSections(result.sections)}
        overviewHref={classBasePath}
        classBasePath={classBasePath}
        sortBy={sort}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        finalCountedEvents={result.finalCountedEvents}
        countedEvents={result.countedEvents}
      />
    </>
  );
}
