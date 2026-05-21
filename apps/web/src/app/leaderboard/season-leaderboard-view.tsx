import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SeasonStandingsByClass, SeasonStandingsRow } from "@/lib/season-leaderboard";
import { SeasonSwitcher } from "./season-switcher";

interface SeasonLeaderboardViewProps {
  year: number;
  years: number[];
  standings: SeasonStandingsByClass[];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function DriverRow({
  driver,
  rank,
}: {
  driver: SeasonStandingsRow;
  rank: number;
}) {
  return (
    <TableRow
      className={
        rank === 1
          ? "bg-primary/5 hover:bg-primary/10"
          : "odd:bg-background even:bg-muted/10 hover:bg-accent/30"
      }
    >
      {/* Rank */}
      <TableCell className="px-3 py-3 w-10 tabular-nums text-muted-foreground">
        {rank}
      </TableCell>

      {/* Driver name + provisional badge */}
      <TableCell className="px-3 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/drivers/${driver.driverId}`}
            className="hover:underline font-medium"
          >
            {driver.driverName}
          </Link>
          {!driver.eligible && (
            <Badge variant="outline" className="text-xs">
              Provisional · {driver.eventsCountedInClass}/4
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Total points */}
      <TableCell className="px-3 py-3 text-right tabular-nums font-semibold">
        {driver.totalPoints}
      </TableCell>

      {/* Per-event score chips */}
      <TableCell className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {driver.scores.map((score) => (
            <Link
              key={score.eventId}
              href={`/events/${score.eventSlug}`}
              title={`${score.eventName} — ${formatDate(score.eventDate)}`}
              className={
                score.dropped
                  ? "text-muted-foreground line-through text-xs tabular-nums hover:no-underline"
                  : "text-xs tabular-nums hover:underline"
              }
            >
              {score.points}
            </Link>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ClassSection({
  section,
}: {
  section: SeasonStandingsByClass;
}) {
  if (section.drivers.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
      <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
          {section.classCode}
        </h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground w-10">
              #
            </TableHead>
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Driver
            </TableHead>
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
              Points
            </TableHead>
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Event scores
              <span className="ml-1 normal-case font-normal text-muted-foreground/60">
                (best 4 count · struck-through = dropped)
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.drivers.map((driver, i) => (
            <DriverRow key={driver.driverId} driver={driver} rank={i + 1} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SeasonLeaderboardView({
  year,
  years,
  standings,
}: SeasonLeaderboardViewProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          Season standings
        </p>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {year} Season Leaderboard
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Points are awarded per event: 1000 to the class winner, others
                proportional. Best 4 scores count toward the season total.
                Drivers with fewer than 4 events are marked Provisional.
              </p>
            </div>
          </div>
          {years.length > 1 && (
            <div className="shrink-0">
              <SeasonSwitcher years={years} currentYear={year} />
            </div>
          )}
        </div>
      </header>

      {standings.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12 text-center text-sm text-muted-foreground">
          No season data available for {year}.
        </div>
      ) : (
        standings.map((section) => (
          <ClassSection key={section.classCode} section={section} />
        ))
      )}
    </main>
  );
}
