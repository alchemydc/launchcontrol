import { guardLeagueAdmin, guardSuperUser } from "@/lib/admin-guard";
import { updateLeague, deleteLeague, type UpdateLeaguePatch } from "@/lib/create-league";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { expireResultsCache } from "@/lib/results-cache";

// updateLeague/deleteLeague pull in create-league.ts, which uses node:fs.
export const runtime = "nodejs";

const PATCH_KEYS = [
  "name",
  "siteTitle",
  "siteDescription",
  "footerText",
  "landingDescription",
  "accessGate",
  "msrOrgId",
  "logoUrl",
  "smugmugUser",
  "smugmugDisciplinePath",
] as const satisfies readonly (keyof UpdateLeaguePatch)[];

function toPatch(body: Record<string, unknown>): UpdateLeaguePatch {
  const patch: UpdateLeaguePatch = {};
  for (const key of PATCH_KEYS) {
    if (!(key in body)) continue;
    // updateLeague validates accessGate/logoUrl shape itself; this only
    // narrows to the wire type, it does not re-validate values.
    (patch as Record<string, unknown>)[key] = body[key];
  }
  return patch;
}

export async function PATCH(
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
  const patch = toPatch(body as Record<string, unknown>);

  try {
    // Mutation + audit row commit or roll back together.
    const league = await prisma.$transaction(async (tx) => {
      const updated = await updateLeague(tx, slug, patch);
      await writeAudit(tx, {
        action: "league.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "league",
        targetSlug: slug,
        detail: { league: slug, patch: Object.keys(patch) },
      });
      return updated;
    });
    // League config (branding, SmugMug fields, access gate) renders on
    // public pages — expire the ISR cache so the change is visible now.
    expireResultsCache();
    return Response.json({ league: { slug: league.slug, name: league.name } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = await guardSuperUser();
  if (g instanceof Response) return g;

  try {
    // The audit row rides inside deleteLeague's own transaction.
    await deleteLeague(prisma, slug, async (tx) => {
      await writeAudit(tx, {
        action: "league.delete",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "league",
        targetSlug: slug,
        detail: { league: slug },
      });
    });
    expireResultsCache();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 400 });
  }
}
