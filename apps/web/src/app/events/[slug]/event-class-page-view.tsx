import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { prisma } from "@/lib/prisma";
import {
  availableEventViews,
  buildLeaderboard,
  resolveEventView,
  summarizeEventClasses,
} from "@/lib/leaderboard";
import { classingHints } from "@/lib/classing-registry";
import { findEventBySlug } from "@/lib/event-queries";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { EventClassNav } from "./event-class-nav";
import { LeaderboardTable } from "./leaderboard-table";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function EventClassPageView({
  leagueId,
  leagueSlug,
  slug,
  rawClass,
  basePath = "",
}: {
  leagueId: number;
  /** Selects this league's classing model for the class hover cards. */
  leagueSlug: string;
  slug: string;
  rawClass: string;
  basePath?: string;
}) {
  const event = await findEventBySlug(leagueId, slug, prisma);
  if (!event) notFound();

  // One lookup for the whole table: every row on this page belongs to the same
  // event, so it shares one league and one season.
  const classing = classingHints({
    leagueSlug,
    year: event.season.year,
    seasonLabel: event.season.name,
    seasonSlug: event.season.slug,
    basePath,
  });

  const policy = parseScoringPolicy(event.season.ruleset.policy);
  const rows = buildLeaderboard(event.entries, policy.conePenaltyMs);
  const view = resolveEventView(rows, decodeClassParam(rawClass), policy.paxSection);
  if (view == null) notFound();
  const { rows: classRows, label: classLabel, paxView, navActive } = view;

  const summaries = summarizeEventClasses(rows, policy.paxSection);
  const virtualViews = availableEventViews(rows, policy.paxSection);
  const eventHref = `${basePath}/events/${slug}`;

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref={eventHref} />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            {formatDate(event.date)}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <h1 className="min-w-0 text-2xl sm:text-3xl font-semibold tracking-tight">
              {event.name}
              <span className="text-muted-foreground"> · {classLabel}</span>
            </h1>
          </div>
          <Badge variant="default" className="shrink-0 sm:ml-4">
            {classRows.length} {classRows.length === 1 ? "entry" : "entries"}
          </Badge>
        </div>
      </header>

      <EventClassNav
        slug={slug}
        classCodes={summaries.map((summary) => summary.classCode)}
        rawAvailable={virtualViews.raw}
        paxAvailable={virtualViews.pax}
        active={navActive}
        basePath={basePath}
      />

      <LeaderboardTable
        rows={classRows}
        paxView={paxView}
        driverBasePath={basePath}
        classing={classing}
      />
    </main>
  );
}
