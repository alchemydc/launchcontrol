import { notFound } from "next/navigation";
import {
  buildSeasonLeaderboard,
  findSeasonSection,
  listSeasonYears,
  summarizeSeasonSections,
} from "@/lib/season-leaderboard";
import { SeasonLeaderboardView } from "../../season-leaderboard-view";
import { gateResultsPage } from "@/lib/session";

// ISR: rendered on demand, then cached for 5 minutes. Gated deployments
// (ACCESS_GATE=required) read cookies inside gateResultsPage and render
// per-request instead.
export const revalidate = 300;

/** Class URL segments may arrive percent-encoded; a stray `%` must 404, not 500. */
function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function LeaderboardClassPage({
  params,
}: {
  params: Promise<{ year: string; class: string }>;
}) {
  const { year: yearStr, class: rawClass } = await params;

  // Gate runs before the year/class checks so unauth viewers can't probe
  // valid vs invalid params.
  await gateResultsPage(`/leaderboard/${yearStr}/${rawClass}`);

  const year = Number(yearStr);

  // Validate: must be a finite integer in a sensible calendar range
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    notFound();
  }

  const years = await listSeasonYears();
  const result = await buildSeasonLeaderboard(year);
  const section = findSeasonSection(result.sections, decodeClassParam(rawClass));
  if (section == null) notFound();

  return (
    <SeasonLeaderboardView
      year={year}
      years={years}
      section={section}
      allSummaries={summarizeSeasonSections(result.sections)}
      totalEvents={result.totalEvents}
      completedEvents={result.completedEvents}
      qualifyingEvents={result.qualifyingEvents}
      countedEvents={result.countedEvents}
    />
  );
}
