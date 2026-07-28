import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SeasonClassSummary } from "@/lib/season-leaderboard";
import { SeasonHeader } from "./season-header";

interface SeasonOverviewViewProps {
  title: string;
  switcher?: ReactNode;
  periodLabel: string;
  classBasePath: string;
  summaries: SeasonClassSummary[];
  totalEvents: number;
  completedEvents: number;
  qualifyingEvents: number;
  finalCountedEvents: number;
  countedEvents: number;
}

/**
 * `/leaderboard/[year]` landing: one row per class linking to its standings
 * page. Leader names are plain text (not DriverLink) — the whole row is the
 * anchor, and anchors don't nest.
 */
export function SeasonOverviewView({
  title,
  switcher,
  periodLabel,
  classBasePath,
  summaries,
  totalEvents,
  completedEvents,
  qualifyingEvents,
  finalCountedEvents,
  countedEvents,
}: SeasonOverviewViewProps) {
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
        hasStandings={summaries.length > 0}
      />

      {summaries.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">
            No season data available for {periodLabel}.
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Classes — pick one for full standings
            </h2>
          </div>
          <ul className="divide-y divide-border/60">
            {summaries.map((s) => (
              <li key={s.classCode}>
                <Link
                  href={`${classBasePath}/${encodeURIComponent(s.classCode)}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors odd:bg-background even:bg-muted/10 hover:bg-accent/40"
                >
                  <span className="w-14 shrink-0 text-sm font-semibold uppercase tracking-wide text-foreground">
                    {s.classCode}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
                    {s.driverCount} {s.driverCount === 1 ? "driver" : "drivers"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {s.leader != null && (
                      <>
                        Leader: <span className="text-foreground">{s.leader.driverName}</span>{" "}
                        · <span className="tabular-nums">{s.leader.totalPoints}</span> pts
                      </>
                    )}
                  </span>
                  <span aria-hidden className="shrink-0 text-muted-foreground">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
