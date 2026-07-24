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
import type {
  SeasonStandingsByClass,
  SeasonStandingsRow,
} from "@/lib/season-leaderboard";

interface SeasonLeaderboardViewProps {
  /** Heading text, e.g. "2026 Season Leaderboard" (legacy, by year) or
   *  "<Season name> Leaderboard" (league-scoped, by season). */
  title: string;
  /** Rendered in the header's switcher slot (already wrapped in its layout
   *  div by the caller) — `null`/omitted renders nothing, same as the
   *  legacy `years.length > 1` guard did inline. */
  switcher?: ReactNode;
  /** Short label for the empty-standings message ("No season data available
   *  for {periodLabel}.") — the bare year for legacy pages, the season name
   *  for league-scoped pages. */
  periodLabel: string;
  standings: SeasonStandingsByClass[];
  totalEvents: number;
  completedEvents: number;
  qualifyingEvents: number;
  countedEvents: number;
  /** `?class=` query value — only this class's table is rendered (the full
   *  page for a big league is megabytes of HTML; see ClassJumpBar). Unknown
   *  or omitted → the first non-empty section (PAX when present). */
  activeClassCode?: string | null;
  /** `?sort=` query value — row order within the class. Rank pills always
   *  show the CHAMPIONSHIP position (by points) regardless of sort. */
  sortBy?: string | null;
  /** "" for the legacy route (byte-identical to pre-Task-20 driver hrefs),
   *  "/l/[slug]" for league-scoped — threaded to every `DriverLink` below. */
  driverBasePath?: string;
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

function EventScoreChip({ score }: { score: EventScore }) {
  const dropped = score.dropped;
  const title = `${score.eventName} — ${formatDate(score.eventDate)}${score.combined ? " (combined)" : ""}${dropped ? " (dropped)" : ""}`;
  return (
    <Link
      href={score.href}
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

function EventScoreStrip({ scores }: { scores: EventScore[] }) {
  if (scores.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {scores.map((s) => (
        <EventScoreChip key={s.key} score={s} />
      ))}
    </div>
  );
}

function DriverCard({
  driver,
  rank,
  driverBasePath,
}: {
  driver: SeasonStandingsRow;
  rank: number;
  driverBasePath?: string;
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
            basePath={driverBasePath}
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
          <EventScoreStrip scores={driver.scores} />
        </div>
      )}
    </li>
  );
}

function DriverTableRow({
  driver,
  rank,
  driverBasePath,
}: {
  driver: SeasonStandingsRow;
  rank: number;
  driverBasePath?: string;
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
          <DriverLink driverId={driver.driverId} name={driver.driverName} basePath={driverBasePath} />
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
        <EventScoreStrip scores={driver.scores} />
      </TableCell>
    </TableRow>
  );
}

// Scoring-rule copy that stays truthful in both SEASON_DROPS modes: in fixed
// mode countedEvents === qualifyingEvents, reproducing the original sentence
// byte-for-byte; in proportional mode mid-season it states the current
// counted target and the season-end rule.
function scoringNote(
  countedEvents: number,
  qualifyingEvents: number,
  totalEvents: number,
): string {
  if (countedEvents === qualifyingEvents) {
    return `Best ${qualifyingEvents} of ${totalEvents} scores count toward the season total.`;
  }
  return `Best ${countedEvents} scores currently count toward the season total (best ${qualifyingEvents} of ${totalEvents} at season end).`;
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
// The jump bar navigates via `?class=` (server renders just that section)
// instead of in-page anchors.
function resolveActiveSection(
  standings: SeasonStandingsByClass[],
  activeClassCode: string | null | undefined,
): SeasonStandingsByClass | null {
  const nonEmpty = standings.filter((s) => s.drivers.length > 0);
  return (
    nonEmpty.find((s) => s.classCode === activeClassCode) ??
    nonEmpty[0] ??
    null
  );
}

function SortHeaderLink({
  label,
  sortKey,
  currentSort,
  activeClassCode,
  title,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  activeClassCode: string;
  title?: string;
}) {
  const active = currentSort === sortKey;
  const query =
    sortKey === "points"
      ? `?class=${encodeURIComponent(activeClassCode)}`
      : `?class=${encodeURIComponent(activeClassCode)}&sort=avg`;
  return (
    <Link
      href={query}
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
  qualifyingEvents,
  countedEvents,
  sort,
  driverBasePath,
}: {
  section: SeasonStandingsByClass;
  totalEvents: number;
  qualifyingEvents: number;
  countedEvents: number;
  sort: SortKey;
  driverBasePath?: string;
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
              basePath={driverBasePath}
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
            driverBasePath={driverBasePath}
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
                  activeClassCode={section.classCode}
                />
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                <SortHeaderLink
                  label="Avg"
                  sortKey="avg"
                  currentSort={sort}
                  activeClassCode={section.classCode}
                  title="Average points per counted championship event (dropped scores excluded)"
                />
              </TableHead>
              <TableHead
                className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                title={`${scoringNote(countedEvents, qualifyingEvents, totalEvents)} Dashed border = dropped score.`}
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
                driverBasePath={driverBasePath}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ClassJumpBar({
  standings,
  activeClassCode,
  sort,
}: {
  standings: SeasonStandingsByClass[];
  activeClassCode: string | null;
  sort: SortKey;
}) {
  const sections = standings.filter((s) => s.drivers.length > 0);
  if (sections.length < 2) return null;
  const sortSuffix = sort === "avg" ? "&sort=avg" : "";
  return (
    <nav aria-label="Select class" className="mb-6">
      {/* flex-wrap (not overflow-x-auto) so the class list wraps to multiple
          lines like the event page's class filter. `?class=` navigation —
          the server renders only the selected class's section. */}
      <ul className="flex flex-wrap gap-1.5">
        {sections.map((s) => {
          const active = s.classCode === activeClassCode;
          return (
            <li key={s.classCode}>
              <Link
                href={`?class=${encodeURIComponent(s.classCode)}${sortSuffix}`}
                scroll={false}
                className={
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none " +
                  (active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground/80 hover:border-primary/40 hover:text-primary")
                }
              >
                {s.classCode}
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
  periodLabel,
  standings,
  totalEvents,
  completedEvents,
  qualifyingEvents,
  countedEvents,
  activeClassCode,
  sortBy,
  driverBasePath,
}: SeasonLeaderboardViewProps) {
  const activeSection = resolveActiveSection(standings, activeClassCode);
  const sort = resolveSort(sortBy);
  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          Season standings
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {title}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Points are awarded per event: 1000 to the class winner, others
                proportional. Combined (same-date, multi-session) events score
                once, on summed session times.{" "}
                {scoringNote(countedEvents, qualifyingEvents, totalEvents)}{" "}
                Drivers with fewer than {qualifyingEvents} scoring events are
                marked Provisional.
              </p>
            </div>
          </div>
          {switcher}
        </div>
      </header>

      {completedEvents < qualifyingEvents && standings.length > 0 && (
        <div className="mb-6 flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">
            Standings are provisional until {qualifyingEvents} of{" "}
            {totalEvents} events are complete ({completedEvents} run so far).
          </p>
        </div>
      )}

      <ClassJumpBar
        standings={standings}
        activeClassCode={activeSection?.classCode ?? null}
        sort={sort}
      />

      {activeSection == null ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">
            No season data available for {periodLabel}.
          </p>
        </div>
      ) : (
        <ClassSection
          key={activeSection.classCode}
          section={activeSection}
          totalEvents={totalEvents}
          qualifyingEvents={qualifyingEvents}
          countedEvents={countedEvents}
          sort={sort}
          driverBasePath={driverBasePath}
        />
      )}
    </main>
  );
}
