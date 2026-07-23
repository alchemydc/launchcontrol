import { guardSuperUser } from "@/lib/admin-guard";
import { setSuperUser } from "@/lib/super-user";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  const g = await guardSuperUser();
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
  if (typeof b.granted !== "boolean") {
    return Response.json({ error: "granted must be a boolean" }, { status: 400 });
  }

  try {
    await setSuperUser(prisma, msrUid, b.granted);
    try {
      await writeAudit(prisma, {
        action: "superuser.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "superUser",
        targetSlug: msrUid,
        detail: { msrUid, granted: b.granted },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}
