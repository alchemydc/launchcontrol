import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { prisma } from "@/lib/prisma";
import { buildLeaderboard, formatMs, summarizeEventClasses } from "@/lib/leaderboard";
import { getClubConfig } from "@/lib/club-config";
import { findSmugmugEventFolder } from "@/lib/smugmug";
import { gateResultsPage } from "@/lib/session";
import { EventClassNav } from "./event-class-nav";

// ISR: rendered on demand, then cached for 5 minutes. Gated deployments
// (ACCESS_GATE=required) read cookies inside gateResultsPage and render
// per-request instead.
export const revalidate = 300;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Gate runs before notFound() so unauth viewers can't probe slug existence.
  await gateResultsPage(`/events/${slug}`);

  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      entries: {
        include: {
          driver: true,
          class: true,
          paxClass: true,
          runs: true,
        },
      },
    },
  });

  if (!event) notFound();

  // Combined-event cross-link (M1.15): any other events sharing this event's
  // calendar date form one combined scoring event.
  const siblingCount = await prisma.event.count({
    where: { date: event.date, id: { not: event.id } },
  });
  const dateKey = event.date.toISOString().slice(0, 10);

  const club = getClubConfig();
  const rows = buildLeaderboard(event.entries);
  const summaries = summarizeEventClasses(rows, club.paxStandings);
  const photosUrl = await findSmugmugEventFolder(event.name, event.date);
  // Synthetic PAX view is reachable only when no real class occupies the
  // "pax" segment (case-insensitive — mirrors the class-route matching).
  const paxAvailable =
    club.paxStandings && !rows.some((r) => r.classCode.toLowerCase() === "pax");

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref="/" />
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
            href={`/events/combined/${dateKey}`}
            className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10"
          >
            <Badge variant="secondary" className="text-[10px]">Combined event</Badge>
            <span>Session of a combined event · View combined results →</span>
          </Link>
        )}
      </header>

      <EventClassNav
        slug={slug}
        classCodes={summaries.map((s) => s.classCode)}
        paxAvailable={paxAvailable}
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
                href={`/events/${slug}/pax`}
                className="flex items-center gap-3 px-4 py-3 transition-colors bg-primary/5 hover:bg-primary/10"
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
          {summaries.map((s) => (
            <li key={s.classCode}>
              <Link
                href={`/events/${slug}/${encodeURIComponent(s.classCode)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors odd:bg-background even:bg-muted/10 hover:bg-accent/40"
              >
                <span className="w-14 shrink-0 text-sm font-semibold uppercase tracking-wide text-foreground">
                  {s.classCode}
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
                  {s.entryCount} {s.entryCount === 1 ? "entry" : "entries"}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {s.winner != null && (
                    <>
                      Winner: <span className="text-foreground">{s.winner.driverName}</span>{" "}
                      · <span className="tabular-nums">{formatMs(s.winner.bestRawMs)}</span>
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
