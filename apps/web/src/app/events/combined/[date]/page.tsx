import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildCombinedResults } from "@/lib/combined-event";
import { findSmugmugEventFolder } from "@/lib/smugmug";
import { requireRmrMember } from "@/lib/session";
import { CombinedResultsView } from "./combined-results-view";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function CombinedEventPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  // Gate runs before any validation/data fetch so unauth viewers can't probe
  // valid vs. invalid dates (same pattern as /events/[slug]).
  await requireRmrMember(`/events/combined/${date}`);

  if (!DATE_RE.test(date)) notFound();

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) notFound();

  const events = await prisma.event.findMany({
    where: { date: dayStart },
    orderBy: { name: "asc" },
    include: {
      entries: {
        include: {
          driver: true,
          class: true,
          runs: true,
        },
      },
    },
  });

  if (events.length === 0) notFound();
  if (events.length === 1) redirect(`/events/${events[0]!.slug}`);

  const results = buildCombinedResults(events);
  const photosUrl = await findSmugmugEventFolder(results.label, dayStart);

  return (
    <CombinedResultsView
      results={results}
      dateLabel={formatDateLabel(dayStart)}
      photosUrl={photosUrl}
    />
  );
}
