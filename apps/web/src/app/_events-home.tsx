import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { listSeasonsForLeague, pickActiveSeason } from "@/lib/season-resolve";
import { findSmugmugEventFolder, type SmugmugLeagueTarget } from "@/lib/smugmug";

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

const LEGACY_SUBTITLE =
  "Rocky Mountain Region autocross results, sorted by most recent event.";

export async function EventsHome({
  searchParams,
  leagueId,
  basePath = "",
  smugmugTarget,
  subtitle = LEGACY_SUBTITLE,
}: {
  searchParams: Promise<{ season?: string; returnTo?: string | string[] }>;
  /** Explicit league scope (Task 5) — the legacy home page passes the
   *  deployment's default league's id; `/l/[league]` passes that league's. */
  leagueId: number;
  /** URL prefix for this listing's links — "" for the legacy home page
   *  (byte-identical to pre-Task-5 hrefs), "/l/[slug]" for league-scoped. */
  basePath?: string;
  /** SmugMug lookup target — omitted falls back to the default league
   *  (pre-Task-5 behavior); `/l/[league]` passes that league's config so
   *  photos never resolve against the wrong league. */
  smugmugTarget?: SmugmugLeagueTarget;
  /** Header subtitle copy — defaults to the legacy PCA RMR string byte-for-byte
   *  (pre-Task-5 behavior, still used by the unprefixed legacy home page);
   *  `/l/[league]` passes that league's own `siteDescription` so a non-default
   *  league's events page never carries the default league's branding. */
  subtitle?: string;
}) {
  const { season: seasonParam } = await searchParams;

  // The subnav season selector is the single season control; the events list
  // scopes to the chosen season (its `?season=` slug), defaulting to the
  // league's active season — the same default the subnav shows. That default
  // comes out of the list we already hold; querying for it separately was a
  // second round trip for a row we had in hand.
  const seasons = await listSeasonsForLeague(prisma, leagueId);
  const selectedSeason =
    seasons.find((s) => s.slug === seasonParam) ?? pickActiveSeason(seasons) ?? seasons[0] ?? null;

  const events = selectedSeason
    ? await prisma.event.findMany({
        where: { seasonId: selectedSeason.id },
        // Secondary `name asc` after `date desc` gives deterministic A/B ordering
        // for combined-event sessions (both store the date at 00:00 UTC, so date
        // alone doesn't disambiguate).
        orderBy: [{ date: "desc" }, { name: "asc" }],
        include: { _count: { select: { entries: true } } },
      })
    : [];

  // Combined-event grouping (M1.15): events sharing a calendar date form one
  // combined scoring event — its sessions render together inside one shared
  // combined-event frame that links to the combined results.
  const dateCounts = new Map<string, number>();
  for (const event of events) {
    const dateKey = event.date.toISOString().slice(0, 10);
    dateCounts.set(dateKey, (dateCounts.get(dateKey) ?? 0) + 1);
  }

  const photosByEventId = new Map(
    await Promise.all(
      events.map(
        async (e) =>
          [e.id, await findSmugmugEventFolder(e.name, e.date, smugmugTarget)] as const,
      ),
    ),
  );

  // Group adjacent same-date events (combined sessions) into a single list
  // item so they can render inside one shared combined-event frame instead
  // of as repeated independent cards.
  type EventWithCount = (typeof events)[number];
  type GroupedItem =
    | { kind: "single"; event: EventWithCount }
    | { kind: "group"; dateKey: string; events: EventWithCount[] };

  const groupedItems: GroupedItem[] = [];
  for (const event of events) {
    const dateKey = event.date.toISOString().slice(0, 10);
    const isCombined = (dateCounts.get(dateKey) ?? 0) > 1;
    if (!isCombined) {
      groupedItems.push({ kind: "single", event });
      continue;
    }
    const last = groupedItems[groupedItems.length - 1];
    if (last && last.kind === "group" && last.dateKey === dateKey) {
      last.events.push(event);
    } else {
      groupedItems.push({ kind: "group", dateKey, events: [event] });
    }
  }

  return (
    <main className="w-full mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          {selectedSeason?.name ?? "Season"}
        </p>
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Event results
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              {subtitle}
            </p>
          </div>
        </div>
      </header>

      {events.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="text-sm text-muted-foreground">
            {seasons.length === 0 ? (
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
              <>
                No events for {selectedSeason?.name ?? "this season"}. Try a
                different season from the selector above.
              </>
            )}
          </div>
        </div>
      ) : (
        <section className="rounded-3xl border border-border/70 bg-muted/20 p-3 shadow-sm">
          <ul className="space-y-3">
            {groupedItems.map((item) =>
              item.kind === "single" ? (
                <li key={item.event.id}>
                  <Card className="group relative border border-border/70 bg-background/95 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:shadow-md">
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground mb-1">
                          {formatDateShort(item.event.date)}
                        </p>
                        <CardTitle className="group-hover:text-primary transition-colors">
                          <Link
                            href={`${basePath}/events/${item.event.slug}`}
                            className="after:content-[''] after:absolute after:inset-0"
                          >
                            {item.event.name}
                          </Link>
                        </CardTitle>
                      </div>
                      <div className="relative z-10 flex flex-col items-end gap-2 shrink-0">
                        {photosByEventId.get(item.event.id) && (
                          <a
                            href={photosByEventId.get(item.event.id)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-sm"
                          >
                            Photos ↗
                          </a>
                        )}
                        <Badge variant="secondary">
                          {item.event._count.entries} entries
                        </Badge>
                      </div>
                    </CardHeader>
                  </Card>
                </li>
              ) : (
                <li key={item.dateKey}>
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          {formatDateShort(item.events[0]!.date)}
                        </p>
                        <Badge variant="outline" className="text-[10px]">
                          Combined event
                        </Badge>
                      </div>
                      <Link
                        href={`${basePath}/events/combined/${item.dateKey}`}
                        className="text-primary hover:underline text-xs"
                      >
                        View combined results →
                      </Link>
                    </div>
                    <div className="space-y-2">
                      {item.events.map((event) => (
                        <Card
                          key={event.id}
                          className="group relative border border-border/70 bg-background/95 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:shadow-md"
                        >
                          <CardHeader className="flex flex-row items-start justify-between gap-4">
                            <div className="min-w-0">
                              <CardTitle className="group-hover:text-primary transition-colors">
                                <Link
                                  href={`${basePath}/events/${event.slug}`}
                                  className="after:content-[''] after:absolute after:inset-0"
                                >
                                  {event.name}
                                </Link>
                              </CardTitle>
                            </div>
                            <div className="relative z-10 flex flex-col items-end gap-2 shrink-0">
                              {photosByEventId.get(event.id) && (
                                <a
                                  href={photosByEventId.get(event.id)!}
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
                        </Card>
                      ))}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
