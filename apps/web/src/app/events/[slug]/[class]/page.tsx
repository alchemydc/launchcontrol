import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { prisma } from "@/lib/prisma";
import {
  buildLeaderboard,
  classUsesPaxMetric,
  filterRowsForClass,
  summarizeEventClasses,
  type LeaderboardRow,
} from "@/lib/leaderboard";
import { getClubConfig } from "@/lib/club-config";
import { gateResultsPage } from "@/lib/session";
import { EventClassNav } from "../event-class-nav";
import { LeaderboardTable } from "../leaderboard-table";

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

/** Class URL segments may arrive percent-encoded; a stray `%` must 404, not 500. */
function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function EventClassPage({
  params,
}: {
  params: Promise<{ slug: string; class: string }>;
}) {
  const { slug, class: rawClass } = await params;

  // Gate runs before notFound() so unauth viewers can't probe slug existence.
  await gateResultsPage(`/events/${slug}/${rawClass}`);

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

  const club = getClubConfig();
  const rows = buildLeaderboard(event.entries);
  const classParam = decodeClassParam(rawClass);

  // A real class always wins the segment; the synthetic PAX view fills the
  // "pax" slot only when PAX standings are enabled and no real class
  // occupies it (same precedence rule as the season leaderboard).
  const realClass = filterRowsForClass(rows, classParam);
  let classRows: LeaderboardRow[];
  let classLabel: string;
  let paxView: boolean;
  let navActive: string;
  if (realClass != null) {
    classRows = realClass.rows;
    classLabel = realClass.classCode;
    paxView = classUsesPaxMetric(classRows, club.paxStandings);
    navActive = realClass.classCode;
  } else if (club.paxStandings && classParam.trim().toLowerCase() === "pax") {
    classRows = rows;
    classLabel = "PAX standings";
    paxView = true;
    navActive = "pax";
  } else {
    notFound();
  }

  const summaries = summarizeEventClasses(rows, club.paxStandings);
  const paxAvailable =
    club.paxStandings && !rows.some((r) => r.classCode.toLowerCase() === "pax");

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref={`/events/${slug}`} />
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
                <span className="text-muted-foreground"> · {classLabel}</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 sm:ml-4">
            <Badge variant="default">
              {classRows.length} {classRows.length === 1 ? "entry" : "entries"}
            </Badge>
          </div>
        </div>
      </header>

      <EventClassNav
        slug={slug}
        classCodes={summaries.map((s) => s.classCode)}
        paxAvailable={paxAvailable}
        active={navActive}
      />

      <LeaderboardTable rows={classRows} paxView={paxView} />
    </main>
  );
}
