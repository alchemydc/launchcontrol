// Public league directory data (`/leagues`) — Task 5. Always public: the
// directory itself carries no gated content, only names/links (spec: "Always
// public (no gate — it's a directory; league CONTENT respects each league's
// gate)").

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { activeSeason } from "@/lib/season-resolve";

export type LeagueDirectoryEntry = {
  slug: string;
  name: string;
  siteTitle: string;
  /** Null when the league has no active season yet (see `activeSeason`). */
  activeSeasonName: string | null;
  /** Event count for the active season; 0 when there is none. */
  eventCount: number;
};

/**
 * Every League row, ordered by name, with its active season's name (per
 * `season-resolve.ts`'s `activeSeason`: status "active", newest year, ties
 * broken by newest id) and that season's event count.
 */
export async function listLeagueDirectory(
  client: PrismaClient = defaultClient,
): Promise<LeagueDirectoryEntry[]> {
  const leagues = await client.league.findMany({ orderBy: { name: "asc" } });

  return Promise.all(
    leagues.map(async (league) => {
      const season = await activeSeason(client, league.id);
      const eventCount = season
        ? await client.event.count({ where: { seasonId: season.id } })
        : 0;

      return {
        slug: league.slug,
        name: league.name,
        siteTitle: league.siteTitle,
        activeSeasonName: season?.name ?? null,
        eventCount,
      };
    }),
  );
}
