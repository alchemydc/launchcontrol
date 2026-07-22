import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { buildDriverHistory } from "@/lib/driver-history";
import { formatDriverName } from "@/lib/club-config";
import { ProgressionChart, type ProgressionPoint } from "./progression-chart";
import { TimeDeltaChart } from "./time-delta-chart";
import { BackButton } from "@/components/back-button";
import { EventHistory } from "./event-history";
import { requireRmrMember } from "@/lib/session";

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


export default async function DriverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Gate runs before notFound() so unauth viewers can't probe driver id existence.
  await requireRmrMember(`/drivers/${id}`);

  const driverId = Number(id);
  if (!Number.isInteger(driverId) || driverId <= 0) notFound();

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) notFound();

  const history = await buildDriverHistory(driverId);
  const driverName = formatDriverName(driver);

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
    eventName: row.eventName,
    position: row.position,
    percentile: row.percentile,
    diffFromLeaderPct: row.diffFromLeaderPct,
    diffFromMedianPct: row.diffFromMedianPct,
  }));

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <BackButton fallbackHref="/leaderboard" />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Driver · {driverId}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {driverName}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 sm:ml-4">
            <Badge variant="default">
              {history.length} {history.length === 1 ? "event" : "events"}
            </Badge>
          </div>
        </div>
      </header>

      <div className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
            Summary
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 p-4">
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Events
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {history.length}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Best finish
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {bestPosition ?? "—"}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Avg finish
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {avgPosition == null ? "—" : avgPosition.toFixed(1)}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Best percentile
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(bestPercentile)}
            </div>
          </div>
          <div className="rounded-md bg-background px-3 py-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-1">
              Avg percentile
            </p>
            <div className="text-2xl font-semibold tabular-nums">
              {formatPercent(avgPercentile)}
            </div>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <>
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
            <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
                Progression
              </h2>
            </div>
            <div className="p-4">
              <ProgressionChart data={chartData} />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6">
            <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground">
                Time differential
              </h2>
            </div>
            <div className="p-4">
              <TimeDeltaChart data={chartData} />
            </div>
          </div>
        </>
      )}

      <EventHistory history={history} />
    </main>
  );
}
