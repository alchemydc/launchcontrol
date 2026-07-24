import { notFound } from "next/navigation";
import {
  buildSeasonLeaderboard,
  findSeasonSection,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { prisma } from "@/lib/prisma";
import { SeasonLeaderboardView } from "@/app/leaderboard/season-leaderboard-view";
import { SeasonOverviewView } from "@/app/leaderboard/season-overview-view";

function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function renderLeagueSeasonLeaderboard({
  leagueSlug,
  leagueName,
  season,
  classParam,
  sortBy,
}: {
  leagueSlug: string;
  leagueName: string;
  season: { id: number; slug: string; name: string } | null;
  classParam?: string;
  sortBy?: string | null;
}) {
  const driverBasePath = `/l/${leagueSlug}`;
  const activeSeasonPath = `${driverBasePath}/leaderboard`;
  const classBasePath = season
    ? `${activeSeasonPath}/s/${season.slug}`
    : activeSeasonPath;
  const title = season
    ? `${season.name} Leaderboard`
    : `${leagueName} Leaderboard`;
  const periodLabel = season?.name ?? leagueName;

  if (!season) {
    if (classParam != null) notFound();
    return (
      <SeasonOverviewView
        title={title}
        periodLabel={periodLabel}
        classBasePath={classBasePath}
        summaries={[]}
        totalEvents={0}
        completedEvents={0}
        qualifyingEvents={0}
        countedEvents={0}
      />
    );
  }

  const result = await buildSeasonLeaderboard({ seasonId: season.id }, prisma);
  const summaries = summarizeSeasonSections(result.sections);

  if (classParam == null) {
    return (
      <SeasonOverviewView
        title={title}
        periodLabel={periodLabel}
        classBasePath={classBasePath}
        summaries={summaries}
        totalEvents={result.totalEvents}
        completedEvents={result.completedEvents}
        qualifyingEvents={result.qualifyingEvents}
        countedEvents={result.countedEvents}
      />
    );
  }

  const section = findSeasonSection(
    result.sections,
    decodeClassParam(classParam),
  );
  if (section == null) notFound();

  return (
    <SeasonLeaderboardView
      title={title}
      section={section}
      allSummaries={summaries}
      overviewHref={classBasePath}
      classBasePath={classBasePath}
      sortBy={sortBy}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
      driverBasePath={driverBasePath}
    />
  );
}
