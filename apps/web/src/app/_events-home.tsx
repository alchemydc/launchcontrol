import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EventsYearSwitcher } from "./events-year-switcher";
import { prisma } from "@/lib/prisma";
import { listSeasonYears } from "@/lib/season-leaderboard";
import { findSmugmugEventFolder } from "@/lib/smugmug";

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export async function EventsHome({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; returnTo?: string | string[] }>;
}) {
  const { year: yearParam } = await searchParams;

  const years = await listSeasonYears();
  const fallbackYear = new Date().getUTCFullYear();
  const requested = yearParam ? Number(yearParam) : NaN;
  const year =
    Number.isFinite(requested) && years.includes(requested)
      ? requested
      : (years[0] ?? fallbackYear);

  const events = await prisma.event.findMany({
    where: {
      date: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
    // Secondary `name asc` after `date desc` gives deterministic A/B ordering
    // for combined-event sessions (both store the date at 00:00 UTC, so date
    // alone doesn't disambiguate).
    orderBy: [{ date: "desc" }, { name: "asc" }],
    include: { _count: { select: { entries: true } } },
  });

  // Combined-event grouping (M1.15): events sharing a calendar date form one
  // combined scoring event — badge each session card and link each one to the
  // combined standings.
  const dateCounts = new Map<string, number>();
  for (const event of events) {
    const dateKey = event.date.toISOString().slice(0, 10);
    dateCounts.set(dateKey, (dateCounts.get(dateKey) ?? 0) + 1);
  }

  const photosUrls = await Promise.all(
    events.map((e) => findSmugmugEventFolder(e.name, e.date)),
  );

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          {year} Season
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Event results
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Rocky Mountain Region autocross results, sorted by most recent
                event.
              </p>
            </div>
          </div>
          {years.length > 1 && (
            <div className="sm:shrink-0 sm:ml-4">
              <EventsYearSwitcher
                years={years}
                currentYear={year}
              />
            </div>
          )}
        </div>
      </header>

      {events.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="text-sm text-muted-foreground">
            {years.length === 0 ? (
              <>
                No events ingested yet. Run{" "}
                <code className="bg-muted rounded px-1.5 py-0.5">
                  pnpm ingest &lt;path-to-axdb&gt;
                </code>{" "}
                from{" "}
                <code className="bg-muted rounded px-1.5 py-0.5">apps/web</code>{" "}
                to publish results.
              </>
            ) : (
              <>No events for {year}. Try a different season above.</>
            )}
          </div>
        </div>
      ) : (
        <section className="rounded-3xl border border-border/70 bg-muted/20 p-3 shadow-sm">
          <ul className="space-y-3">
            {events.map((event, i) => {
              const dateKey = event.date.toISOString().slice(0, 10);
              const isCombined = (dateCounts.get(dateKey) ?? 0) > 1;

              return (
                <li key={event.id}>
                  <Card className="group relative border border-border/70 bg-background/95 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:shadow-md">
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground mb-1">
                          {formatDateShort(event.date)}
                        </p>
                        <CardTitle className="group-hover:text-primary transition-colors">
                          <Link
                            href={`/events/${event.slug}`}
                            className="after:content-[''] after:absolute after:inset-0"
                          >
                            {event.name}
                          </Link>
                        </CardTitle>
                        {isCombined && (
                          <Badge variant="outline" className="mt-1.5 text-[10px]">
                            Combined event
                          </Badge>
                        )}
                      </div>
                      <div className="relative z-10 flex flex-col items-end gap-2 shrink-0">
                        {photosUrls[i] && (
                          <a
                            href={photosUrls[i]!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-sm"
                          >
                            Photos ↗
                          </a>
                        )}
                        <Badge variant="secondary">
                          {event._count.entries} entries
                        </Badge>
                      </div>
                    </CardHeader>
                    {isCombined && (
                      <div className="relative z-10 px-6 pb-4 -mt-2">
                        <Link
                          href={`/events/combined/${dateKey}`}
                          className="text-primary hover:underline text-xs"
                        >
                          View combined standings →
                        </Link>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
