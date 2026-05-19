import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { buildDriverHistory } from "@/lib/driver-history";
import { formatMs } from "@/lib/leaderboard";
import { ProgressionChart, type ProgressionPoint } from "./progression-chart";
import { TimeDeltaChart } from "./time-delta-chart";

export const dynamic = "force-dynamic";

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

export default async function DriverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const driverId = Number(id);
  if (!Number.isInteger(driverId) || driverId <= 0) notFound();

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) notFound();

  const history = await buildDriverHistory(driverId);
  const driverName = `${driver.firstName} ${driver.lastInitial}`;

  const cleanRows = history.filter((r) => r.position != null);
  const bestPosition =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.position as number));
  const bestPercentile =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.percentile as number));
  const avgPosition =
    cleanRows.length === 0
      ? null
      : cleanRows.reduce((sum, r) => sum + (r.position as number), 0) /
        cleanRows.length;
  const avgPercentile =
    cleanRows.length === 0
      ? null
      : cleanRows.reduce((sum, r) => sum + (r.percentile as number), 0) /
        cleanRows.length;

  const chartData: ProgressionPoint[] = history.map((row) => ({
    date: row.eventDate.toISOString(),
    label: formatDate(row.eventDate),
    position: row.position,
    percentile: row.percentile,
    diffFromLeaderPct: row.diffFromLeaderPct,
    diffFromMedianPct: row.diffFromMedianPct,
  }));

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
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {driverName}
            </h1>
            {driver.memberNum && (
              <p className="text-muted-foreground mt-1 text-sm">
                PCA #{driver.memberNum}
              </p>
            )}
          </div>
          <Badge variant="secondary">
            {history.length} {history.length === 1 ? "event" : "events"}
          </Badge>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {history.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Best finish
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {bestPosition ?? "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Avg finish
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {avgPosition == null ? "—" : avgPosition.toFixed(1)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Best percentile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(bestPercentile)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Avg percentile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(avgPercentile)}
            </div>
          </CardContent>
        </Card>
      </section>

      {history.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            No event results yet for this driver.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Progression</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressionChart data={chartData} />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Time differential</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeDeltaChart data={chartData} />
            </CardContent>
          </Card>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead title="Your entered car class. If your PAX-scored class differs (rare), it appears as a secondary tag.">
                    Class
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Your best PAX-adjusted time at the event. Lower is faster."
                  >
                    Best PAX
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="The fastest PAX-adjusted time of any driver at the event."
                  >
                    Leader PAX
                  </TableHead>
                  <TableHead className="text-right">Position</TableHead>
                  <TableHead className="text-right">Percentile</TableHead>
                  <TableHead
                    className="text-right"
                    title="How much slower (or faster) your PAX time was than the event leader's. 0% = tied with the leader; negative = ahead."
                  >
                    vs. event leader
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="How your PAX time compared to the median PAX time across all entrants at the event. 0% = matched the middle of the field; negative = beat it."
                  >
                    vs. event median
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.eventId}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(row.eventDate)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/events/${row.eventSlug}`}
                        className="hover:underline"
                      >
                        {row.eventName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline">{row.classCode}</Badge>
                        {row.paxClassCode !== row.classCode && (
                          <span className="text-muted-foreground text-xs">
                            PAX {row.paxClassCode}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMs(row.bestPaxMs)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {formatMs(row.leaderPaxMs)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.position == null
                        ? "—"
                        : `${row.position} / ${row.entrantCount}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(row.percentile)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSignedPercent(row.diffFromLeaderPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSignedPercent(row.diffFromMedianPct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}
