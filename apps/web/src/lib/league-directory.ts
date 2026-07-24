// Public league directory data (`/leagues`) — Task 5. Always public: the
// directory itself carries no gated content, only names/links (spec: "Always
// public (no gate — it's a directory; league CONTENT respects each league's
// gate)").

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { activeSeason } from "@/lib/season-resolve";

export type LeagueDirectoryEntry = {
  id: number;
  slug: string;
  name: string;
  siteTitle: string;
  siteDescription: string;
  /** Logo image URL for the league gate card grid; null renders a placeholder tile. */
  logoUrl: string | null;
  /** Null when the league has no active season yet (see `activeSeason`). */
  activeSeasonName: string | null;
  /** Event count for the active season; 0 when there is none. */
  eventCount: number;
  /** Distinct drivers with at least one entry anywhere in the league (all seasons, not just the active one). */
  driverCount: number;
};

/**
 * Every League row, ordered by name, with its active season's name (per
 * `season-resolve.ts`'s `activeSeason`: status "active", newest year, ties
 * broken by newest id), that season's event count, and a driver count.
 *
 * One query per league for the active season + event count + driver count
 * (N+1) — deliberate, not a bug: the deployments this addresses have a
 * handful of leagues (single digits), so trading a join for readability here
 * is a fine trade. Revisit only if league counts grow into the dozens.
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
      const driverCount = await client.driver.count({
        where: { entries: { some: { event: { season: { leagueId: league.id } } } } },
      });

      return {
        id: league.id,
        slug: league.slug,
        name: league.name,
        siteTitle: league.siteTitle,
        siteDescription: league.siteDescription,
        logoUrl: league.logoUrl,
        activeSeasonName: season?.name ?? null,
        eventCount,
        driverCount,
      };
    }),
  );
}
