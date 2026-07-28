import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { administeredLeagues } from "@/lib/admin";
import { EventsTable, type EventRow } from "./events-table";
import { EventsFilterBar } from "./events-filter-bar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage events",
};

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; season?: string }>;
}) {
  const { league: leagueParam, season: seasonParam } = await searchParams;
  const session = await getSession();

  // Task 17: scope to leagues the viewer administers (superuser -> every
  // league) even in "all" mode -- a league admin must never see another
  // league's events, whether or not they've picked a specific one.
  const leagues = await administeredLeagues(session.msrUid);
  const leagueIds = leagues.map((l) => l.id);

  const selectedLeague = leagueParam
    ? leagues.find((l) => l.slug === leagueParam)
    : undefined;

  // Season <select> options + ?season= resolution are both scoped to the
  // chosen league -- a season slug is only unique within its league
  // (`Season` is `@@unique([leagueId, slug])`), so it's meaningless without
  // one.
  const seasons = selectedLeague
    ? await prisma.season.findMany({
        where: { leagueId: selectedLeague.id },
        orderBy: { year: "desc" },
      })
    : [];
  const selectedSeason = selectedLeague
    ? seasons.find((s) => s.slug === seasonParam)
    : undefined;

  const events =
    leagueIds.length === 0
      ? []
      : await prisma.event.findMany({
          where: selectedSeason
            ? { seasonId: selectedSeason.id }
            : selectedLeague
              ? { season: { leagueId: selectedLeague.id } }
              : { season: { leagueId: { in: leagueIds } } },
          orderBy: { date: "desc" },
          include: { _count: { select: { entries: true, videos: true } } },
        });

  // One query for all run counts (Run has no eventId, so go through Entry)
  // rather than a run.count per event — Turso pays an HTTP round trip per
  // query. Scoped to just the events in view (via the same where-clause
  // Event was scoped by) rather than every Entry in the DB, now that events
  // themselves are league/season-filtered.
  const entryRunCounts =
    events.length === 0
      ? []
      : await prisma.entry.findMany({
          where: { eventId: { in: events.map((e) => e.id) } },
          select: { eventId: true, _count: { select: { runs: true } } },
        });
  const runsByEvent = new Map<number, number>();
  for (const entry of entryRunCounts) {
    runsByEvent.set(entry.eventId, (runsByEvent.get(entry.eventId) ?? 0) + entry._count.runs);
  }

  const rows: EventRow[] = events.map((event) => ({
    id: event.id,
    name: event.name,
    date: event.date.toISOString(),
    slug: event.slug,
    location: event.location,
    entries: event._count.entries,
    runs: runsByEvent.get(event.id) ?? 0,
    videos: event._count.videos,
    createdAt: event.createdAt.toISOString(),
  }));

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Manage events</h1>
        {leagues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don&apos;t administer any leagues yet.
          </p>
        ) : (
          <>
            <EventsFilterBar
              leagues={leagues.map((l) => ({ slug: l.slug, name: l.name }))}
              seasons={seasons.map((s) => ({ slug: s.slug, name: s.name }))}
              currentLeague={selectedLeague?.slug ?? "all"}
              currentSeason={selectedSeason?.slug ?? "all"}
            />
            <EventsTable rows={rows} />
          </>
        )}
      </div>
    </main>
  );
}
