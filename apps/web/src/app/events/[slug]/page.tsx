import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { prisma } from "@/lib/prisma";
import { buildLeaderboard } from "@/lib/leaderboard";
import { findSmugmugEventFolder } from "@/lib/smugmug";
import { requireRmrMember } from "@/lib/session";
import { LeaderboardTable } from "./leaderboard-table";

export const dynamic = "force-dynamic";

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
  await requireRmrMember(`/events/${slug}`);

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

  const rows = buildLeaderboard(event.entries);
  const photosUrl = await findSmugmugEventFolder(event.name, event.date);
  const classCodes = Array.from(new Set(rows.map((r) => r.classCode))).sort();

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref="/leaderboard" />
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
            <span>Session of a combined event · View combined standings →</span>
          </Link>
        )}
      </header>

      <LeaderboardTable rows={rows} classCodes={classCodes} />
    </main>
  );
}
