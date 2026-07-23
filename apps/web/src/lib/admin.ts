import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { resolveDefaultLeague } from "@/lib/league-config";
import { superUserEnvAllowlist } from "@/lib/super-user";

/**
 * League Foundation compatibility shim: an admin is either a superadmin
 * (env `ADMIN_MSR_UIDS` allowlist — the pre-existing bootstrap mechanism,
 * unchanged) or holds an ADMIN `LeagueMembership` row for the deployment's
 * default league. The env check runs first and short-circuits before any DB
 * access, so a superadmin's admin check never costs a query — only a uid
 * that misses the allowlist falls through to the membership lookup. Schema
 * lands now; the migration does NOT backfill membership rows from env (SQL
 * can't read env vars) — the table starts empty, and the env allowlist
 * remains the sole, first-checked bootstrap mechanism until PR 3 adds
 * writes/UI to populate `LeagueMembership` (today only manual `prisma
 * studio` edits populate the table).
 */
export async function isAdmin(
  msrUid: string | undefined | null,
  client: PrismaClient = defaultClient,
): Promise<boolean> {
  if (!msrUid) return false;
  if (superUserEnvAllowlist().includes(msrUid)) return true;

  const league = await resolveDefaultLeague(client);
  if (!league) return false;

  const membership = await client.leagueMembership.findUnique({
    where: { leagueId_msrUid: { leagueId: league.id, msrUid } },
  });
  return membership?.role === "ADMIN";
}
