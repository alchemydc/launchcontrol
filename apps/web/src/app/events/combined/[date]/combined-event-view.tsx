// Shared combined-event body (Task 5) — extracted from the legacy
// /events/combined/[date] page so both it and the league-scoped equivalent
// (/l/[league]/events/combined/[date] — added alongside /l/[league]/events/
// [slug] so that page's "part of a combined event" cross-link resolves
// within the same league rather than 404ing) render from one place. Callers
// resolve and gate the league themselves before calling this (see page.tsx).

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildCombinedResults } from "@/lib/combined-event";
import { classingHints } from "@/lib/classing-registry";
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
  league: { id: number; slug: string } & SmugmugLeagueTarget;
  date: string;
  /** "" for the legacy route (byte-identical to pre-Task-5 hrefs), "/l/[slug]"
   *  for league-scoped. */
  basePath?: string;
}) {
  if (!DATE_RE.test(date)) notFound();

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) notFound();

  const dateEvents = await findEventsByDate(league.id, dayStart, prisma);

  if (dateEvents.length === 0) notFound();

  // A combined event is one season's morning/afternoon sessions — same-date
  // events from ANOTHER season (e.g. a Winter-series round) are different
  // competitions under different rulesets and must not merge into the group
  // (PR #99 review). Partition by season and render the largest group
  // (ties: lowest seasonId, deterministic); stray other-season events on
  // this date simply aren't part of it.
  const bySeason = new Map<number, typeof dateEvents>();
  for (const event of dateEvents) {
    const group = bySeason.get(event.seasonId) ?? [];
    group.push(event);
    bySeason.set(event.seasonId, group);
  }
  const events = [...bySeason.values()].sort(
    (a, b) => b.length - a.length || a[0]!.seasonId - b[0]!.seasonId,
  )[0]!;

  if (events.length === 1) redirect(`${basePath}/events/${events[0]!.slug}`);

  // All sessions now provably share one Season row (the partition above), so
  // the first session's policy IS the group's policy (Task 7: conePenaltyMs
  // threading).
  const conePenaltyMs = parseScoringPolicy(events[0]!.season.ruleset.policy).conePenaltyMs;
  const results = buildCombinedResults(events, conePenaltyMs);
  const photosUrl = await findSmugmugEventFolder(results.label, dayStart, league);
  // Every session in the group shares one Season (the partition above), so one
  // classing lookup covers the whole combined table.
  const classing = classingHints(
    league.slug,
    events[0]!.season.year,
    events[0]!.season.name,
    basePath,
  );

  return (
    <CombinedResultsView
      results={results}
      dateLabel={formatDateLabel(dayStart)}
      photosUrl={photosUrl}
      basePath={basePath}
      classing={classing}
    />
  );
}
