import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DriverLink } from "@/components/driver-link";
import { RankPill } from "@/components/podium";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { composeEventHref } from "@/lib/event-links";
import type {
  SeasonClassSummary,
  SeasonStandingsByClass,
  SeasonStandingsRow,
} from "@/lib/season-leaderboard";
import { scoringNote, SeasonHeader } from "./season-header";

interface SeasonLeaderboardViewProps {
  /** Heading text, e.g. "2026 Season Leaderboard" (legacy, by year) or
   *  "<Season name> Leaderboard" (league-scoped, by season). */
  title: string;
  /** Rendered in the header's switcher slot (already wrapped in its layout
   *  div by the caller) — `null`/omitted renders nothing, same as the
   *  legacy `years.length > 1` guard did inline. */
  switcher?: ReactNode;
  section: SeasonStandingsByClass;
  allSummaries: SeasonClassSummary[];
  overviewHref: string;
  classBasePath: string;
  totalEvents: number;
  completedEvents: number;
  qualifyingEvents: number;
  finalCountedEvents: number;
  countedEvents: number;
  /** `?sort=` query value — row order within the class. Rank pills always
   *  show the CHAMPIONSHIP position (by points) regardless of sort. */
  sortBy?: string | null;
  /** "" for the legacy route (byte-identical to pre-Task-20 driver hrefs),
   *  "/l/[slug]" for league-scoped — threaded to every `DriverLink` AND every
   *  event-score chip below (score `href`s are league-relative suffixes; see
   *  src/lib/event-links.ts). */
  basePath?: string;
}

type SortKey = "points" | "avg";

function resolveSort(sortBy: string | null | undefined): SortKey {
  return sortBy === "avg" ? "avg" : "points";
}

type EventScore = SeasonStandingsRow["scores"][number];

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function EventScoreChip({ score, basePath }: { score: EventScore; basePath: string }) {
  const dropped = score.dropped;
  const title = `${score.eventName} — ${formatDate(score.eventDate)}${score.combined ? " (combined)" : ""}${dropped ? " (dropped)" : ""}`;
  return (
    <Link
      href={composeEventHref(basePath, score.href)}
      title={title}
      className={
        "relative flex min-w-[3rem] flex-col items-center rounded-md px-1.5 py-1 text-center transition-colors " +
        (dropped
          ? "border border-dashed border-border/70 text-muted-foreground hover:bg-muted/30"
          : "bg-muted/50 text-foreground hover:bg-accent/60")
      }
    >
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80 leading-none">
        {formatDate(score.eventDate)}
      </span>
      <span
        className={
          "mt-1 text-xs tabular-nums font-medium leading-none " +
          (dropped ? "line-through decoration-from-font" : "")
        }
      >
        {score.points}
      </span>
    </Link>
  );
}

function EventScoreStrip({ scores, basePath }: { scores: EventScore[]; basePath: string }) {
  if (scores.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {scores.map((s) => (
        <EventScoreChip key={s.key} score={s} basePath={basePath} />
      ))}
    </div>
  );
}

function DriverCard({
  driver,
  rank,
  basePath,
}: {
  driver: SeasonStandingsRow;
  rank: number;
  basePath?: string;
}) {
  return (
    <li className="px-4 py-3 odd:bg-background even:bg-muted/10">
      <div className="flex items-center gap-3">
        <RankPill rank={rank} />
        <div className="min-w-0 flex-1">
          <DriverLink
            driverId={driver.driverId}
            name={driver.driverName}
            className="block truncate"
            basePath={basePath}
          />
          {!driver.eligible && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              Provisional · {driver.eventsCountedInClass}/
              {driver.qualifyingEvents}
            </Badge>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-semibold tabular-nums leading-none">
            {driver.totalPoints}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            points · avg {formatAvg(driver.averagePoints)}
          </div>
        </div>
      </div>
      {driver.scores.length > 0 && (
        <div className="mt-3">
          <EventScoreStrip scores={driver.scores} basePath={basePath ?? ""} />
        </div>
      )}
    </li>
  );
}

function DriverTableRow({
  driver,
  rank,
  basePath,
}: {
  driver: SeasonStandingsRow;
  rank: number;
  basePath?: string;
}) {
  return (
    <TableRow
      className={
        rank <= 3
          ? "hover:bg-accent/20"
          : "odd:bg-background even:bg-muted/10 hover:bg-accent/30"
      }
    >
      <TableCell className="px-3 py-3 w-12">
        <RankPill rank={rank} />
      </TableCell>
      <TableCell className="px-3 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <DriverLink driverId={driver.driverId} name={driver.driverName} basePath={basePath} />
          {!driver.eligible && (
            <Badge variant="outline" className="text-xs">
              Provisional · {driver.eventsCountedInClass}/
              {driver.qualifyingEvents}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap">
        {driver.totalPoints}
      </TableCell>
      <TableCell className="px-3 py-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
        {formatAvg(driver.averagePoints)}
      </TableCell>
      <TableCell className="px-3 py-3">
        <EventScoreStrip scores={driver.scores} basePath={basePath ?? ""} />
      </TableCell>
    </TableRow>
  );
}

// Always one decimal place — "998.0" / "993.3" — so the column stays
// visually aligned.
function formatAvg(avg: number): string {
  return avg.toFixed(1);
}

function classAnchorId(classCode: string): string {
  return `class-${classCode.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

// One class renders at a time: a season with hundreds of drivers across
// dozens of classes produced an ~8 MB page when every section rendered.
function SortHeaderLink({
  label,
  sortKey,
  currentSort,
  classHref,
  title,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  classHref: string;
  title?: string;
}) {
  const active = currentSort === sortKey;
  const href = sortKey === "points" ? classHref : `${classHref}?sort=avg`;
  return (
    <Link
      href={href}
      scroll={false}
      title={title}
      className={
        "inline-flex items-center gap-1 transition-colors hover:text-foreground " +
        (active ? "text-foreground" : "")
      }
    >
      {label}
      <span aria-hidden className={active ? "" : "invisible"}>
        ↓
      </span>
    </Link>
  );
}

function ClassSection({
  section,
  totalEvents,
  finalCountedEvents,
  countedEvents,
  sort,
  classHref,
  basePath,
}: {
  section: SeasonStandingsByClass;
  totalEvents: number;
  finalCountedEvents: number;
  countedEvents: number;
  sort: SortKey;
  classHref: string;
  basePath?: string;
}) {
  if (section.drivers.length === 0) return null;
  const leader = section.drivers[0];
  const driverCount = section.drivers.length;
  // Championship rank is the position in the incoming (points-sorted) order;
  // re-sorting by Avg reorders rows but keeps each driver's rank pill.
  const rankByDriverId = new Map(
    section.drivers.map((d, i) => [d.driverId, i + 1]),
  );
  const rows =
    sort === "avg"
      ? [...section.drivers].sort((a, b) => b.averagePoints - a.averagePoints)
      : section.drivers;

  return (
    <section
      id={classAnchorId(section.classCode)}
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6"
    >
      <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
            {section.classCode}
          </h2>
          <Badge variant="secondary" className="text-[10px]">
            {driverCount} {driverCount === 1 ? "driver" : "drivers"}
          </Badge>
        </div>
        {leader && (
          <p className="hidden sm:block truncate text-xs text-muted-foreground">
            Leader:{" "}
            <DriverLink
              driverId={leader.driverId}
              name={leader.driverName}
              basePath={basePath}
            />{" "}
            · <span className="tabular-nums">{leader.totalPoints}</span> pts
          </p>
        )}
      </div>

      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {rows.map((d) => (
          <DriverCard
            key={d.driverId}
            driver={d}
            rank={rankByDriverId.get(d.driverId)!}
            basePath={basePath}
          />
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground w-12">
                #
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Driver
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                <SortHeaderLink
                  label="Points"
                  sortKey="points"
                  currentSort={sort}
                  classHref={classHref}
                />
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                <SortHeaderLink
                  label="Avg"
                  sortKey="avg"
                  currentSort={sort}
                  classHref={classHref}
                  title="Average points per counted championship event (dropped scores excluded)"
                />
              </TableHead>
              <TableHead
                className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                title={`${scoringNote(countedEvents, finalCountedEvents, totalEvents)} Dashed border = dropped score.`}
              >
                Event scores
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <DriverTableRow
                key={d.driverId}
                driver={d}
                rank={rankByDriverId.get(d.driverId)!}
                basePath={basePath}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ClassLinkBar({
  summaries,
  activeClassCode,
  overviewHref,
  classBasePath,
}: {
  summaries: SeasonClassSummary[];
  activeClassCode: string;
  overviewHref: string;
  classBasePath: string;
}) {
  return (
    <nav aria-label="Select class" className="mb-6">
      <ul className="flex flex-wrap gap-1.5">
        <li>
          <Link
            href={overviewHref}
            className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none"
          >
            Overview
          </Link>
        </li>
        {summaries.map((summary) => {
          const active = summary.classCode === activeClassCode;
          return (
            <li key={summary.classCode}>
              <Link
                href={`${classBasePath}/${encodeURIComponent(summary.classCode)}`}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none " +
                  (active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground/80 hover:border-primary/40 hover:text-primary")
                }
              >
                {summary.classCode}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SeasonLeaderboardView({
  title,
  switcher,
  section,
  allSummaries,
  overviewHref,
  classBasePath,
  totalEvents,
  completedEvents,
  qualifyingEvents,
  finalCountedEvents,
  countedEvents,
  sortBy,
  basePath,
}: SeasonLeaderboardViewProps) {
  const sort = resolveSort(sortBy);
  const classHref = `${classBasePath}/${encodeURIComponent(section.classCode)}`;
  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <SeasonHeader
        title={title}
        switcher={switcher}
        totalEvents={totalEvents}
        completedEvents={completedEvents}
        qualifyingEvents={qualifyingEvents}
        finalCountedEvents={finalCountedEvents}
        countedEvents={countedEvents}
        hasStandings
      />

      <ClassLinkBar
        summaries={allSummaries}
        activeClassCode={section.classCode}
        overviewHref={overviewHref}
        classBasePath={classBasePath}
      />

      <ClassSection
        section={section}
        totalEvents={totalEvents}
        finalCountedEvents={finalCountedEvents}
        countedEvents={countedEvents}
        sort={sort}
        classHref={classHref}
        basePath={basePath}
      />
    </main>
  );
}
