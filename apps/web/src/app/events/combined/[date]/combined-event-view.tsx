// Shared combined-event body (Task 5) — extracted from the legacy
// /events/combined/[date] page so both it and the league-scoped equivalent
// (/l/[league]/events/combined/[date] — added alongside /l/[league]/events/
// [slug] so that page's "part of a combined event" cross-link resolves
// within the same league rather than 404ing) render from one place. Callers
// resolve and gate the league themselves before calling this (see page.tsx).

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildCombinedResults } from "@/lib/combined-event";
import { findEventsByDate } from "@/lib/event-queries";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { findSmugmugEventFolder, type SmugmugLeagueTarget } from "@/lib/smugmug";
import { CombinedResultsView } from "./combined-results-view";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function CombinedEventPageView({
  league,
  date,
  basePath = "",
}: {
  league: { id: number } & SmugmugLeagueTarget;
  date: string;
  /** "" for the legacy route (byte-identical to pre-Task-5 hrefs), "/l/[slug]"
   *  for league-scoped. */
  basePath?: string;
}) {
  if (!DATE_RE.test(date)) notFound();

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) notFound();

  const events = await findEventsByDate(league.id, dayStart, prisma);

  if (events.length === 0) notFound();
  if (events.length === 1) redirect(`${basePath}/events/${events[0]!.slug}`);

  // All sessions in a combined group share a calendar date within one
  // league, so in practice they share one Season row — the first session's
  // policy is the group's policy (Task 7: conePenaltyMs threading).
  const conePenaltyMs = parseScoringPolicy(events[0]!.season.ruleset.policy).conePenaltyMs;
  const results = buildCombinedResults(events, conePenaltyMs);
  const photosUrl = await findSmugmugEventFolder(results.label, dayStart, league);

  return (
    <CombinedResultsView
      results={results}
      dateLabel={formatDateLabel(dayStart)}
      photosUrl={photosUrl}
      basePath={basePath}
    />
  );
}
