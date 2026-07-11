import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { EventsTable, type EventRow } from "./events-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage events",
};

export default async function AdminEventsPage() {
  const events = await prisma.event.findMany({
    orderBy: { date: "desc" },
    include: { _count: { select: { entries: true, videos: true } } },
  });

  // One query for all run counts (Run has no eventId, so go through Entry)
  // rather than a run.count per event — Turso pays an HTTP round trip per query.
  const entryRunCounts = await prisma.entry.findMany({
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
        <EventsTable rows={rows} />
      </div>
    </main>
  );
}
