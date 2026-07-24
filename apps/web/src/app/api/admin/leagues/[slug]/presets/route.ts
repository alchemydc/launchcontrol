import { guardLeagueAdmin } from "@/lib/admin-guard";
import { createScoringSystem, updateScoringSystem } from "@/lib/scoring-system";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function POST(
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

  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
  }
  if (typeof b.policyJson !== "string" || b.policyJson.trim().length === 0) {
    return Response.json({ error: "policyJson must be a non-empty string" }, { status: 400 });
  }

  try {
    const preset = await createScoringSystem(prisma, { leagueSlug: slug, name: b.name, policyJson: b.policyJson });
    try {
      await writeAudit(prisma, {
        action: "preset.create",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "scoringSystem",
        targetSlug: slug,
        detail: { league: slug, name: preset.name },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ preset }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = await guardLeagueAdmin(slug);
  if (g instanceof Response) return g;

  const name = new URL(request.url).searchParams.get("name");
  if (!name || name.trim().length === 0) {
    return Response.json({ error: "?name= query param is required" }, { status: 400 });
  }

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

  const patch: { name?: string; policyJson?: string } = {};
  if (typeof b.name === "string") patch.name = b.name;
  if (typeof b.policyJson === "string") patch.policyJson = b.policyJson;

  try {
    const preset = await updateScoringSystem(prisma, { leagueSlug: slug, name }, patch);
    try {
      await writeAudit(prisma, {
        action: "preset.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "scoringSystem",
        targetSlug: slug,
        detail: { league: slug, name, patch: Object.keys(patch) },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ preset });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}
