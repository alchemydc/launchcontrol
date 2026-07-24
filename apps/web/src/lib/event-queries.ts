// Event-page data access, league-scoped (Task 4 — explicit league/season
// targets). `Event.slug` is only unique per-season (`@@unique([seasonId,
// slug])`), so a bare `{ where: { slug } }` lookup can cross-resolve between
// two leagues that happen to share a slug once more than one league exists.
// These fns take an explicit `leagueId` and scope through `season.leagueId`
// so that can never happen — added now so the routes arriving in Task 5 (and
// today's legacy routes, which pass the default league) are safe by
// construction rather than by convention.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";

const eventDetailInclude = {
  season: { select: { ruleset: { select: { policy: true } } } },
  entries: {
    include: {
      driver: true,
      class: true,
      paxClass: true,
      runs: true,
    },
  },
} satisfies Prisma.EventInclude;

export type EventDetail = Prisma.EventGetPayload<{ include: typeof eventDetailInclude }>;

/**
 * Resolve the /events/[slug] page's event, scoped to `leagueId` via
 * `season.leagueId`. Returns `null` on a miss (unknown slug, or a slug that
 * belongs to a different league) — callers 404 rather than 500.
 */
export async function findEventBySlug(
  leagueId: number,
  slug: string,
  client: PrismaClient = defaultClient,
): Promise<EventDetail | null> {
  return client.event.findFirst({
    where: { slug, season: { leagueId } },
    include: eventDetailInclude,
  });
}

/**
 * Count sibling events sharing `date` (excluding `excludeEventId`), scoped to
 * `leagueId` — powers the /events/[slug] page's "this is part of a combined
 * event" cross-link. Scoped for the same cross-league-collision reason as
 * `findEventBySlug`: an unrelated league's event landing on the same
 * calendar date must never make a single-league event look combined.
 */
export async function countSiblingEventsByDate(
  leagueId: number,
  date: Date,
  excludeEventId: number,
  client: PrismaClient = defaultClient,
): Promise<number> {
  return client.event.count({
    where: { date, id: { not: excludeEventId }, season: { leagueId } },
  });
}

const combinedSessionInclude = {
  season: { select: { ruleset: { select: { policy: true } } } },
  entries: {
    include: {
      driver: true,
      class: true,
      runs: true,
    },
  },
} satisfies Prisma.EventInclude;

export type CombinedSessionEventRow = Prisma.EventGetPayload<{
  include: typeof combinedSessionInclude;
}>;

/**
 * Resolve every event on `date` for the /events/combined/[date] page, scoped
 * to `leagueId` via `season.leagueId` — see the file header for why bare
 * date lookups are unsafe once more than one league exists.
 */
export async function findEventsByDate(
  leagueId: number,
  date: Date,
  client: PrismaClient = defaultClient,
): Promise<CombinedSessionEventRow[]> {
  return client.event.findMany({
    where: { date, season: { leagueId } },
    orderBy: { name: "asc" },
    include: combinedSessionInclude,
  });
}
