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
import { findEventBySlug } from "@/lib/event-queries";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { EventClassNav } from "./event-class-nav";
import { LeaderboardTable } from "./leaderboard-table";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function decodeClassParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function EventClassPageView({
  leagueId,
  slug,
  rawClass,
  basePath = "",
}: {
  leagueId: number;
  slug: string;
  rawClass: string;
  basePath?: string;
}) {
  const event = await findEventBySlug(leagueId, slug, prisma);
  if (!event) notFound();

  const policy = parseScoringPolicy(event.season.ruleset.policy);
  const rows = buildLeaderboard(event.entries, policy.conePenaltyMs);
  const classParam = decodeClassParam(rawClass);
  const realClass = filterRowsForClass(rows, classParam);

  let classRows: LeaderboardRow[];
  let classLabel: string;
  let paxView: boolean;
  let navActive: string;
  if (realClass != null) {
    classRows = realClass.rows;
    classLabel = realClass.classCode;
    paxView = classUsesPaxMetric(classRows, policy.paxSection);
    navActive = realClass.classCode;
  } else if (
    policy.paxSection &&
    classParam.trim().toLowerCase() === "pax"
  ) {
    classRows = rows;
    classLabel = "PAX standings";
    paxView = true;
    navActive = "pax";
  } else {
    notFound();
  }

  const summaries = summarizeEventClasses(rows, policy.paxSection);
  const paxAvailable =
    policy.paxSection &&
    !rows.some((row) => row.classCode.toLowerCase() === "pax");
  const eventHref = `${basePath}/events/${slug}`;

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref={eventHref} />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            {formatDate(event.date)}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <h1 className="min-w-0 text-2xl sm:text-3xl font-semibold tracking-tight">
              {event.name}
              <span className="text-muted-foreground"> · {classLabel}</span>
            </h1>
          </div>
          <Badge variant="default" className="shrink-0 sm:ml-4">
            {classRows.length} {classRows.length === 1 ? "entry" : "entries"}
          </Badge>
        </div>
      </header>

      <EventClassNav
        slug={slug}
        classCodes={summaries.map((summary) => summary.classCode)}
        paxAvailable={paxAvailable}
        active={navActive}
        basePath={basePath}
      />

      <LeaderboardTable
        rows={classRows}
        paxView={paxView}
        driverBasePath={basePath}
      />
    </main>
  );
}
