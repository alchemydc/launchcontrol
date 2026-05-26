import type { PrismaClient } from "@/generated/prisma/client";
import { bestCorrectedMsForEntry } from "@/lib/entry-best";
import { prisma } from "@/lib/prisma";

export type DriverHistoryRow = {
  eventId: number;
  eventSlug: string;
  eventName: string;
  eventDate: Date;
  classCode: string;
  paxClassCode: string;
  carNumber: string;
  bestRawMs: number | null;
  bestPaxMs: number | null;
  leaderPaxMs: number | null;
  entrantCount: number;
  position: number | null;
  percentile: number | null;
  diffFromLeaderPct: number | null;
  medianPaxMs: number | null;
  diffFromMedianPct: number | null;
};

export type EntryForHistory = {
  id: number;
  driverId: number;
  carNumber: string;
  bestCommittedRunNumber: number | null;
  class: { code: string };
  paxClass: { code: string; paxIndex: { toString(): string } };
  runs: Array<{
    runNumber: number;
    rawTimeMs: number | null;
    cones: number;
    disposition: "CLEAN" | "DNF" | "RRN" | "OFF" | "DSQ";
  }>;
};

export function bestPaxMsForEntry(entry: EntryForHistory): {
  bestRawMs: number | null;
  bestPaxMs: number | null;
} {
  const bestRawMs = bestCorrectedMsForEntry(entry);
  if (bestRawMs == null) return { bestRawMs: null, bestPaxMs: null };
  const paxIndex = Number(entry.paxClass.paxIndex.toString());
  return { bestRawMs, bestPaxMs: Math.round(bestRawMs * paxIndex) };
}

export async function buildDriverHistory(
  driverId: number,
  prismaClient: PrismaClient = prisma,
): Promise<DriverHistoryRow[]> {
  const events = await prismaClient.event.findMany({
    where: { entries: { some: { driverId } } },
    orderBy: { date: "asc" },
    include: {
      entries: {
        include: {
          class: { select: { code: true } },
          paxClass: { select: { code: true, paxIndex: true } },
          runs: {
            select: { runNumber: true, rawTimeMs: true, cones: true, disposition: true },
          },
        },
      },
    },
  });

  return events.map((event): DriverHistoryRow => {
    const ranked = event.entries
      .map((e) => ({ entry: e, ...bestPaxMsForEntry(e) }))
      .filter((r): r is typeof r & { bestPaxMs: number } => r.bestPaxMs != null)
      .sort((a, b) => a.bestPaxMs - b.bestPaxMs);

    const leaderPaxMs = ranked[0]?.bestPaxMs ?? null;

    // Median PAX time across all entrants with a clean run at this event.
    // Class-agnostic so the comparison works for any club, not just PCA.
    const medianPaxMs =
      ranked.length === 0
        ? null
        : ranked.length % 2 === 1
          ? (ranked[(ranked.length - 1) / 2] as (typeof ranked)[number]).bestPaxMs
          : Math.round(
              ((ranked[ranked.length / 2 - 1] as (typeof ranked)[number])
                .bestPaxMs +
                (ranked[ranked.length / 2] as (typeof ranked)[number])
                  .bestPaxMs) /
                2,
            );

    // A driver may have multiple entries at one event (co-drive); pick their best.
    const driverRanked = ranked.filter((r) => r.entry.driverId === driverId);
    const best = driverRanked[0];
    const position =
      best == null ? null : ranked.findIndex((r) => r.entry.id === best.entry.id) + 1;

    // The "display" entry is the driver's best-PAX entry if they had a clean run,
    // otherwise just the first entry we have for them at this event.
    const displayEntry =
      best?.entry ?? event.entries.find((e) => e.driverId === driverId)!;

    const bestRawMs = best?.bestRawMs ?? null;
    const bestPaxMs = best?.bestPaxMs ?? null;

    const diffFromLeaderPct =
      bestPaxMs == null || leaderPaxMs == null || leaderPaxMs === 0
        ? null
        : (bestPaxMs - leaderPaxMs) / leaderPaxMs;

    const diffFromMedianPct =
      bestPaxMs == null || medianPaxMs == null || medianPaxMs === 0
        ? null
        : (bestPaxMs - medianPaxMs) / medianPaxMs;

    return {
      eventId: event.id,
      eventSlug: event.slug,
      eventName: event.name,
      eventDate: event.date,
      classCode: displayEntry.class.code,
      paxClassCode: displayEntry.paxClass.code,
      carNumber: displayEntry.carNumber,
      bestRawMs,
      bestPaxMs,
      leaderPaxMs,
      entrantCount: ranked.length,
      position,
      percentile:
        position == null || ranked.length === 0 ? null : position / ranked.length,
      diffFromLeaderPct,
      medianPaxMs,
      diffFromMedianPct,
    };
  });
}
