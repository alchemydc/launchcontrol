// Shared event-detail body (Task 5) — extracted from the legacy
// /events/[slug] page so both it and /l/[league]/events/[slug] render the
// exact same JSX from one place instead of forking it. Callers resolve and
// gate the league themselves (the gate must run before this component's
// notFound() so unauth viewers can't probe slug existence via 404 vs
// redirect behavior — see page.tsx) and pass its `{ id, smugmugUser,
// smugmugDisciplinePath }` shape, which both the raw Prisma `League` row and
// `LeagueConfig` satisfy.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { prisma } from "@/lib/prisma";
import {
  buildLeaderboard,
  formatMs,
  summarizeEventClasses,
} from "@/lib/leaderboard";
import { countSiblingEventsByDate, findEventBySlug } from "@/lib/event-queries";
import { findSmugmugEventFolder, type SmugmugLeagueTarget } from "@/lib/smugmug";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { EventClassNav } from "./event-class-nav";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function EventPageView({
  league,
  slug,
  basePath = "",
}: {
  league: { id: number } & SmugmugLeagueTarget;
  slug: string;
  /** "" for the legacy route (byte-identical to pre-Task-5 hrefs), "/l/[slug]"
   *  for league-scoped. */
  basePath?: string;
}) {
  const event = await findEventBySlug(league.id, slug, prisma);
  if (!event) notFound();

  // Server-resolved from this event's season policy (Task 7: conePenaltyMs
  // threading) — the client leaderboard table only ever sees the resulting
  // boolean/corrected-times, never the policy itself.
  const policy = parseScoringPolicy(event.season.ruleset.policy);
  const showPaxView = policy.paxSection;

  // Combined-event cross-link (M1.15): any other events sharing this event's
  // calendar date (within the same league) form one combined scoring event.
  const siblingCount = await countSiblingEventsByDate(league.id, event.date, event.id, prisma);
  const dateKey = event.date.toISOString().slice(0, 10);

  const rows = buildLeaderboard(event.entries, policy.conePenaltyMs);
  const photosUrl = await findSmugmugEventFolder(event.name, event.date, league);
  const summaries = summarizeEventClasses(rows, showPaxView);
  const paxAvailable =
    showPaxView && !rows.some((row) => row.classCode.toLowerCase() === "pax");
  const eventHref = `${basePath}/events/${slug}`;

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref={basePath || "/"} />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            {formatDate(event.date)}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {event.name}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 sm:ml-4">
            {photosUrl && (
              <a
                href={photosUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm"
              >
                Photos ↗
              </a>
            )}
            <Badge variant="default">{rows.length} entries</Badge>
          </div>
        </div>
        {siblingCount > 0 && (
          <Link
            href={`${basePath}/events/combined/${dateKey}`}
            className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10"
          >
            <Badge variant="secondary" className="text-[10px]">Combined event</Badge>
            <span>Session of a combined event · View combined results →</span>
          </Link>
        )}
      </header>

      <EventClassNav
        slug={slug}
        classCodes={summaries.map((summary) => summary.classCode)}
        paxAvailable={paxAvailable}
        basePath={basePath}
      />

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Classes — pick one for full results
          </h2>
        </div>
        <ul className="divide-y divide-border/60">
          {paxAvailable && (
            <li>
              <Link
                href={`${eventHref}/pax`}
                className="flex items-center gap-3 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
              >
                <span className="w-14 shrink-0 text-sm font-semibold uppercase tracking-wide text-primary">
                  PAX
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Overall standings — every entry ranked on indexed time
                </span>
                <span aria-hidden className="shrink-0 text-muted-foreground">→</span>
              </Link>
            </li>
          )}
          {summaries.map((summary) => (
            <li key={summary.classCode}>
              <Link
                href={`${eventHref}/${encodeURIComponent(summary.classCode)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors odd:bg-background even:bg-muted/10 hover:bg-accent/40"
              >
                <span className="w-14 shrink-0 text-sm font-semibold uppercase tracking-wide text-foreground">
                  {summary.classCode}
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
                  {summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {summary.winner != null && (
                    <>
                      Winner: <span className="text-foreground">{summary.winner.driverName}</span>{" "}
                      · <span className="tabular-nums">{formatMs(summary.winner.bestRawMs)}</span>
                    </>
                  )}
                </span>
                <span aria-hidden className="shrink-0 text-muted-foreground">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
