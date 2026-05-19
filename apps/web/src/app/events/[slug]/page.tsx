import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { buildLeaderboard } from "@/lib/leaderboard";
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

  const rows = buildLeaderboard(event.entries);
  const classCodes = Array.from(new Set(rows.map((r) => r.classCode))).sort();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← All events
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
          <Badge variant="default">{rows.length} entries</Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">{formatDate(event.date)}</p>
      </header>

      <LeaderboardTable rows={rows} classCodes={classCodes} />
    </main>
  );
}
