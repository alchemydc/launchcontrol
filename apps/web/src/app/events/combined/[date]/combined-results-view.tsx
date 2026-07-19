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
import { formatMs } from "@/lib/leaderboard";
import type { CombinedResultRow, CombinedResults, CombinedSection } from "@/lib/combined-event";

function SessionCell({
  session,
}: {
  session: CombinedResultRow["sessions"][number];
}) {
  if (session.correctedMs == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums">
      {session.runNumber != null && session.runNumber > 0 && (
        <span className="text-muted-foreground/70">R{session.runNumber}: </span>
      )}
      {formatMs(session.correctedMs)}
    </span>
  );
}

function RankedTable({
  rows,
  sessions,
  showClassColumn,
}: {
  rows: CombinedResultRow[];
  sessions: CombinedResults["sessions"];
  showClassColumn: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No qualifying results.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground w-12">
              #
            </TableHead>
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Driver
            </TableHead>
            {showClassColumn && (
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Class
              </TableHead>
            )}
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Car #
            </TableHead>
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Vehicle
            </TableHead>
            {sessions.map((s) => (
              <TableHead
                key={s.id}
                className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right"
              >
                {s.name}
              </TableHead>
            ))}
            <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
              Time Sum
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow
              key={row.driverId}
              className={i < 3 ? "hover:bg-accent/20" : "odd:bg-background even:bg-muted/10 hover:bg-accent/30"}
            >
              <TableCell className="px-3 py-3 w-12">
                <RankPill rank={i + 1} />
              </TableCell>
              <TableCell className="px-3 py-3">
                <DriverLink driverId={row.driverId} name={row.driverName} />
              </TableCell>
              {showClassColumn && (
                <TableCell className="px-3 py-3">
                  <Badge variant="secondary" className="text-[10px]">
                    {row.classCode}
                  </Badge>
                </TableCell>
              )}
              <TableCell className="px-3 py-3 tabular-nums">{row.carNumber}</TableCell>
              <TableCell className="px-3 py-3 text-muted-foreground">
                {row.carDescription ?? "—"}
              </TableCell>
              {row.sessions.map((s) => (
                <TableCell key={s.eventId} className="px-3 py-3 text-right">
                  <SessionCell session={s} />
                </TableCell>
              ))}
              <TableCell className="px-3 py-3 text-right font-semibold tabular-nums">
                {formatMs(row.sumMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UnrankedList({
  rows,
  showClassColumn,
}: {
  rows: CombinedResultRow[];
  showClassColumn: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        No score — missed a session or class mismatch
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.driverId}
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-sm"
          >
            <DriverLink driverId={row.driverId} name={row.driverName} className="shrink-0" />
            {showClassColumn && row.classCode && (
              <Badge variant="outline" className="text-[10px]">
                {row.classCode}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {row.classMismatch
                ? "raced a different class in each session"
                : `missing ${row.missingSessions.join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsSection({
  title,
  section,
  sessions,
  showClassColumn,
}: {
  title: string;
  section: CombinedSection;
  sessions: CombinedResults["sessions"];
  showClassColumn: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
      <div className="flex items-center gap-2 bg-muted/40 px-4 py-3 border-b border-border/60">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">{title}</h2>
        <Badge variant="secondary" className="text-[10px]">
          {section.ranked.length} scored
        </Badge>
      </div>
      <RankedTable rows={section.ranked} sessions={sessions} showClassColumn={showClassColumn} />
      <UnrankedList rows={section.unranked} showClassColumn={showClassColumn} />
    </section>
  );
}

export function CombinedResultsView({
  results,
  dateLabel,
  photosUrl,
}: {
  results: CombinedResults;
  dateLabel: string;
  photosUrl: string | null;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          {dateLabel} · Combined event
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{results.label}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Ranked by summed best-corrected time across every session. A driver scores
                only when they posted a countable time in the same class in every session.
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {results.sessions.map((s) => (
                  <Link key={s.id} href={`/events/${s.slug}`} className="text-primary hover:underline">
                    {s.name} ↗
                  </Link>
                ))}
              </div>
            </div>
          </div>
          {photosUrl && (
            <a
              href={photosUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm shrink-0"
            >
              Photos ↗
            </a>
          )}
        </div>
      </header>

      <ResultsSection title="Overall" section={results.overall} sessions={results.sessions} showClassColumn />

      {results.classes.map((section) => (
        <ResultsSection
          key={section.classCode}
          title={section.classCode ?? ""}
          section={section}
          sessions={results.sessions}
          showClassColumn={false}
        />
      ))}
    </main>
  );
}
