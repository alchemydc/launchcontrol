import type { League } from "@/generated/prisma/client";
import { getSession } from "@/lib/session";
import { isSuperUser } from "@/lib/super-user";
import { isLeagueAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

/**
 * Shared guard module for the league/season/preset/membership/superuser
 * admin REST routes (extracted/generalized from the `guard()` helper in
 * `api/admin/events/[id]/route.ts`, which keeps its own copy — not
 * migrated here). Every guard here fails CLOSED with an identical 404
 * `{ error: "not found" }`, whether the caller is unauthenticated, the
 * target doesn't exist, or the caller is authenticated but not permitted —
 * the admin surface stays invisible to a non-admin prober rather than
 * leaking which slugs exist or that admin routes exist at all.
 */

export type AdminActor = { msrUid: string; name: string };

function notFound(): Response {
  return Response.json({ error: "not found" }, { status: 404 });
}

async function actorFromSession(): Promise<AdminActor | null> {
  const session = await getSession();
  if (!session.msrUid) return null;
  const name = [session.firstName, session.lastInitial].filter(Boolean).join(" ") || "unknown";
  return { msrUid: session.msrUid, name };
}

/** Superuser-only gate: league delete + the superusers admin route. */
export async function guardSuperUser(): Promise<{ actor: AdminActor } | Response> {
  const actor = await actorFromSession();
  if (!actor) return notFound();
  if (!(await isSuperUser(actor.msrUid, prisma))) return notFound();
  return { actor };
}

/**
 * League-scoped admin gate: superuser, or an ADMIN `LeagueMembership` row
 * for THIS league specifically. Returns the raw `League` row so callers
 * don't need a second lookup for `league.id`/`league.slug`.
 */
export async function guardLeagueAdmin(
  leagueSlug: string,
): Promise<{ actor: AdminActor; league: League } | Response> {
  const actor = await actorFromSession();
  if (!actor) return notFound();
  const league = await prisma.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) return notFound();
  if (!(await isLeagueAdmin(actor.msrUid, league.id, prisma))) return notFound();
  return { actor, league };
}

