import type { Prisma } from "@/generated/prisma/client";
import { guardLeagueAdmin } from "@/lib/admin-guard";
import { setLeagueMembership, removeLeagueMembership, getMembershipRole, parseMembershipRole } from "@/lib/membership";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** Thrown inside the mutation transaction; mapped to a 403 by the handlers. */
class LastAdminError extends Error {}

/**
 * Refuses (403) a league ADMIN demoting/blocking or removing THEMSELVES
 * when they are that league's last ADMIN membership row — prevents an
 * admin from locking everyone (including themselves) out of a league with
 * no remaining administrator. Scoped to explicit `LeagueMembership` rows
 * (a superuser bypassing via env allowlist or a `SuperUser` row doesn't
 * count toward — or away from — this count). Runs inside the same
 * transaction as the mutation so two concurrent self-demotions can't both
 * observe each other as the surviving admin.
 */
async function wouldOrphanLastAdmin(
  db: Prisma.TransactionClient,
  leagueId: number,
  actorMsrUid: string,
  targetMsrUid: string,
): Promise<boolean> {
  if (targetMsrUid !== actorMsrUid) return false;
  const currentRole = await getMembershipRole(db, leagueId, actorMsrUid);
  if (currentRole !== "ADMIN") return false;
  const adminCount = await db.leagueMembership.count({ where: { leagueId, role: "ADMIN" } });
  return adminCount <= 1;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = await guardLeagueAdmin(slug);
  if (g instanceof Response) return g;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const msrUid = typeof b.msrUid === "string" ? b.msrUid.trim() : "";
  if (!msrUid) {
    return Response.json({ error: "msrUid must be a non-empty string" }, { status: 400 });
  }

  let role: ReturnType<typeof parseMembershipRole>;
  try {
    role = parseMembershipRole(b.role);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "invalid role" }, { status: 400 });
  }

  try {
    // Guard check, mutation, and audit share one transaction: the role
    // change must not land without its audit row, and the last-ADMIN check
    // must see the same state the mutation commits against.
    await prisma.$transaction(async (tx) => {
      if (role !== "ADMIN" && (await wouldOrphanLastAdmin(tx, g.league.id, g.actor.msrUid, msrUid))) {
        throw new LastAdminError("cannot change your own role: you are this league's last ADMIN");
      }
      await setLeagueMembership(tx, { leagueId: g.league.id, msrUid, role });
      await writeAudit(tx, {
        action: "membership.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "membership",
        targetSlug: slug,
        detail: { league: slug, msrUid, role },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof LastAdminError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = await guardLeagueAdmin(slug);
  if (g instanceof Response) return g;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const msrUid = typeof b.msrUid === "string" ? b.msrUid.trim() : "";
  if (!msrUid) {
    return Response.json({ error: "msrUid must be a non-empty string" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (await wouldOrphanLastAdmin(tx, g.league.id, g.actor.msrUid, msrUid)) {
        throw new LastAdminError("cannot remove yourself: you are this league's last ADMIN");
      }
      await removeLeagueMembership(tx, { leagueId: g.league.id, msrUid });
      await writeAudit(tx, {
        action: "membership.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "membership",
        targetSlug: slug,
        detail: { league: slug, msrUid, removed: true },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof LastAdminError) {
      return Response.json({ error: e.message }, { status: 403 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "remove failed" }, { status: 400 });
  }
}
