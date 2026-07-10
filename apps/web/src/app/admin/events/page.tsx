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

  const rows: EventRow[] = await Promise.all(
    events.map(async (event) => {
      const runs = await prisma.run.count({ where: { entry: { eventId: event.id } } });
      return {
        id: event.id,
        name: event.name,
        date: event.date.toISOString(),
        slug: event.slug,
        location: event.location,
        entries: event._count.entries,
        runs,
        videos: event._count.videos,
        createdAt: event.createdAt.toISOString(),
      };
    }),
  );

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Manage events</h1>
        <EventsTable rows={rows} />
      </div>
    </main>
  );
}
