/**
 * DefaultLeagueSubnav — server wrapper for the legacy alias routes
 * (/leaderboard, /events/...), which always serve the DEFAULT league.
 * Resolves the default league's config and season list and renders the same
 * LeagueSubnav the /l/[league] layout mounts, so a visitor on a legacy
 * bookmark sees exactly which league they're looking at and lands on scoped
 * URLs when they navigate.
 */

import { getLeagueConfig } from "@/lib/league-config";
import { listSeasonsForLeague, pickActiveSeason } from "@/lib/season-resolve";
import { prisma } from "@/lib/prisma";
import { LeagueSubnav } from "./league-subnav";

export async function DefaultLeagueSubnav() {
  const league = await getLeagueConfig();
  // One Season read, not two: the list already carries the active season.
  const seasons = await listSeasonsForLeague(prisma, league.id);
  const active = pickActiveSeason(seasons);
  return (
    <LeagueSubnav
      slug={league.slug}
      name={league.name}
      seasons={seasons}
      activeSeasonSlug={active?.slug ?? null}
    />
  );
}
