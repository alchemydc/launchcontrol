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
import { historyRowEventHref } from "@/lib/event-links";
import { formatMs } from "@/lib/leaderboard";
import type { DriverHistoryRow } from "@/lib/driver-history";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function formatSignedPercent(value: number | null): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export function EventHistory({
  history,
  basePath = "",
  defaultLeagueSlug,
}: {
  history: DriverHistoryRow[];
  /** "/l/[slug]" on the locked `/l/[league]/drivers/[id]` page — safe to apply
   *  to every row there, since `buildDriverHistory`'s scoped query only returns
   *  in-league events and combined groups key on (leagueId, dateKey), so no row
   *  can straddle leagues. "" on the legacy route, where rows CAN span leagues
   *  (`?league=all` / a non-default `?league=` filter) — each row then links
   *  into its own league via `historyRowEventHref`, unprefixed only for
   *  `defaultLeagueSlug` rows (byte-identical to the pre-league rendering). */
  basePath?: string;
  /** The deployment default league's slug — the league whose events are served
   *  unprefixed at `/events/...`. Unused when `basePath` is non-empty. */
  defaultLeagueSlug: string;
}) {
  // Only true for an "All leagues" filter selection that actually spans more
  // than one league -- every legacy, no-filter (single-league) render keeps
  // this false, so the badge never appears there.
  const showLeagueBadge = history.some((r) => r.leagueId !== history[0]?.leagueId);

  if (history.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
        <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
            Event history
          </h2>
        </div>
        <p className="text-muted-foreground text-sm text-center py-8">
          No event results yet for this driver.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
      <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
          Event history · {history.length}
        </h2>
      </div>

      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {history.map((row) => {
          const beatMedian =
            row.diffFromMedianPct != null && row.diffFromMedianPct < 0;
          return (
            <li
              key={row.eventId}
              className="px-4 py-3 odd:bg-background even:bg-muted/10"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Link
                      href={historyRowEventHref(row, basePath, defaultLeagueSlug)}
                      className="block text-sm font-medium hover:underline truncate"
                    >
                      {row.eventName}
                    </Link>
                    {row.combined && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        Combined
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                    {formatDate(row.eventDate)}
                    {showLeagueBadge && ` · ${row.leagueName}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 mt-0.5">
                  <Badge variant="outline">{row.classCode}</Badge>
                  {row.paxClassCode !== row.classCode && (
                    <span className="text-[10px] text-muted-foreground">
                      PAX {row.paxClassCode}
                    </span>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums">
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Best PAX
                  </dt>
                  <dd className="font-medium mt-0.5">
                    {formatMs(row.bestPaxMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Position
                  </dt>
                  <dd className="mt-0.5">
                    {row.position == null
                      ? "—"
                      : `${row.position} / ${row.entrantCount}`}
                    <span className="text-muted-foreground">
                      {" · "}
                      {formatPercent(row.percentile)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    vs. leader
                  </dt>
                  <dd className="mt-0.5 text-muted-foreground">
                    {formatSignedPercent(row.diffFromLeaderPct)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    vs. median
                  </dt>
                  <dd
                    className={
                      "mt-0.5 " +
                      (beatMedian
                        ? "text-emerald-700 dark:text-emerald-400 font-medium"
                        : "text-muted-foreground")
                    }
                  >
                    {formatSignedPercent(row.diffFromMedianPct)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      {/* Desktop: table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Date
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Event
              </TableHead>
              {showLeagueBadge && (
                <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  League
                </TableHead>
              )}
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Class
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                Best PAX
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                Leader PAX
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                Position
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                Percentile
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                vs. leader
              </TableHead>
              <TableHead className="h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground text-right">
                vs. median
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((row) => (
              <TableRow
                key={row.eventId}
                className="odd:bg-background even:bg-muted/10 hover:bg-accent/30"
              >
                <TableCell className="whitespace-nowrap px-3 tabular-nums text-sm">
                  {formatDate(row.eventDate)}
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex items-center gap-1.5">
                    <Link href={historyRowEventHref(row, basePath, defaultLeagueSlug)} className="hover:underline">
                      {row.eventName}
                    </Link>
                    {row.combined && (
                      <Badge variant="secondary" className="text-[10px]">
                        Combined
                      </Badge>
                    )}
                  </div>
                </TableCell>
                {showLeagueBadge && (
                  <TableCell className="px-3 text-muted-foreground text-sm">
                    {row.leagueName}
                  </TableCell>
                )}
                <TableCell className="px-3">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline">{row.classCode}</Badge>
                    {row.paxClassCode !== row.classCode && (
                      <span className="text-muted-foreground text-xs">
                        PAX {row.paxClassCode}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {formatMs(row.bestPaxMs)}
                </TableCell>
                <TableCell className="px-3 text-muted-foreground text-right tabular-nums">
                  {formatMs(row.leaderPaxMs)}
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {row.position == null
                    ? "—"
                    : `${row.position} / ${row.entrantCount}`}
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {formatPercent(row.percentile)}
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {formatSignedPercent(row.diffFromLeaderPct)}
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {formatSignedPercent(row.diffFromMedianPct)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
