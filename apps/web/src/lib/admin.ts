import type { League, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { isSuperUser } from "@/lib/super-user";

/**
 * Per-league admin gate: `msrUid` is a league admin if they are a superuser
 * (env `ADMIN_MSR_UIDS` allowlist or a SuperUser row — see super-user.ts) or
 * hold an ADMIN `LeagueMembership` row for THIS specific `leagueId`. The
 * superuser check runs first and short-circuits before the membership lookup,
 * so a superuser's check never costs a per-league query. An ADMIN row for a
 * different league grants nothing here.
 */
export async function isLeagueAdmin(
  msrUid: string | null | undefined,
  leagueId: number,
  client: PrismaClient = defaultClient,
): Promise<boolean> {
  if (!msrUid) return false;
  if (await isSuperUser(msrUid, client)) return true;
  const row = await client.leagueMembership.findUnique({
    where: { leagueId_msrUid: { leagueId, msrUid } },
  });
  return row?.role === "ADMIN";
}

/**
 * Coarse admin gate for the `/admin` entry point: `msrUid` is a superuser or
 * holds an ADMIN `LeagueMembership` row for ANY league. Individual admin
 * actions still re-check the specific league via `isLeagueAdmin`.
 */
export async function isAnyLeagueAdmin(
  msrUid: string | null | undefined,
  client: PrismaClient = defaultClient,
): Promise<boolean> {
  if (!msrUid) return false;
  if (await isSuperUser(msrUid, client)) return true;
  const row = await client.leagueMembership.findFirst({
    where: { msrUid, role: "ADMIN" },
  });
  return row !== null;
}

/**
 * Leagues `msrUid` administers, for the `/admin` index (and the events/audit
 * league filters, Task 17): a superuser administers every league, ordered by
 * name; anyone else gets only the leagues where they hold an ADMIN
 * `LeagueMembership` row. Returns `[]` for a blank/missing `msrUid` rather
 * than throwing — callers can render an empty "Leagues" section.
 */
export async function administeredLeagues(
  msrUid: string | null | undefined,
  client: PrismaClient = defaultClient,
): Promise<League[]> {
  if (!msrUid) return [];
  if (await isSuperUser(msrUid, client)) {
    return client.league.findMany({ orderBy: { name: "asc" } });
  }
  const memberships = await client.leagueMembership.findMany({
    where: { msrUid, role: "ADMIN" },
    include: { league: true },
  });
  return memberships.map((m) => m.league).sort((a, b) => a.name.localeCompare(b.name));
}
