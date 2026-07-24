import { guardLeagueAdmin } from "@/lib/admin-guard";
import { setLeagueMembership, removeLeagueMembership, getMembershipRole, parseMembershipRole } from "@/lib/membership";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Refuses (403) a league ADMIN demoting/blocking or removing THEMSELVES
 * when they are that league's last ADMIN membership row — prevents an
 * admin from locking everyone (including themselves) out of a league with
 * no remaining administrator. Scoped to explicit `LeagueMembership` rows
 * (a superuser bypassing via env allowlist or a `SuperUser` row doesn't
 * count toward — or away from — this count).
 */
async function wouldOrphanLastAdmin(leagueId: number, actorMsrUid: string, targetMsrUid: string): Promise<boolean> {
  if (targetMsrUid !== actorMsrUid) return false;
  const currentRole = await getMembershipRole(prisma, leagueId, actorMsrUid);
  if (currentRole !== "ADMIN") return false;
  const adminCount = await prisma.leagueMembership.count({ where: { leagueId, role: "ADMIN" } });
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

  if (role !== "ADMIN" && (await wouldOrphanLastAdmin(g.league.id, g.actor.msrUid, msrUid))) {
    return Response.json(
      { error: "cannot change your own role: you are this league's last ADMIN" },
      { status: 403 },
    );
  }

  try {
    await setLeagueMembership(prisma, { leagueId: g.league.id, msrUid, role });
    try {
      await writeAudit(prisma, {
        action: "membership.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "membership",
        targetSlug: slug,
        detail: { league: slug, msrUid, role },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ ok: true });
  } catch (e) {
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

  if (await wouldOrphanLastAdmin(g.league.id, g.actor.msrUid, msrUid)) {
    return Response.json(
      { error: "cannot remove yourself: you are this league's last ADMIN" },
      { status: 403 },
    );
  }

  try {
    await removeLeagueMembership(prisma, { leagueId: g.league.id, msrUid });
    try {
      await writeAudit(prisma, {
        action: "membership.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "membership",
        targetSlug: slug,
        detail: { league: slug, msrUid, removed: true },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "remove failed" }, { status: 400 });
  }
}
