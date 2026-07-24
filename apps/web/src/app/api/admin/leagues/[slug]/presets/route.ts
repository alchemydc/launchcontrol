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
  if (b.paxTableJson !== undefined && typeof b.paxTableJson !== "string") {
    return Response.json({ error: "paxTableJson must be a string when given" }, { status: 400 });
  }
  const paxTableJson = typeof b.paxTableJson === "string" ? b.paxTableJson : undefined;

  try {
    const preset = await createScoringSystem(prisma, {
      leagueSlug: slug,
      name: b.name,
      policyJson: b.policyJson,
      paxTableJson,
    });
    try {
      await writeAudit(prisma, {
        action: "preset.create",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "scoringSystem",
        targetSlug: slug,
        detail: {
          league: slug,
          name: preset.name,
          after: { policy: preset.policy, paxTable: preset.paxTable },
        },
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

  const patch: { name?: string; policyJson?: string; paxTableJson?: string } = {};
  if (typeof b.name === "string") patch.name = b.name;
  if (typeof b.policyJson === "string") patch.policyJson = b.policyJson;
  if (typeof b.paxTableJson === "string") patch.paxTableJson = b.paxTableJson;

  // Snapshot the pre-update values for the audit trail: since Task R2 a
  // ruleset is a LIVE reference for every season pointing at it, so an edit
  // here changes standings retroactively — the log must show what the
  // scoring config was before, not just that "policy" was patched.
  const before = await prisma.scoringSystem.findFirst({
    where: { league: { slug }, name },
    select: { policy: true, paxTable: true },
  });

  try {
    const preset = await updateScoringSystem(prisma, { leagueSlug: slug, name }, patch);
    try {
      await writeAudit(prisma, {
        action: "preset.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "scoringSystem",
        targetSlug: slug,
        detail: {
          league: slug,
          name,
          patch: Object.keys(patch),
          before: before ? { policy: before.policy, paxTable: before.paxTable } : null,
          after: { policy: preset.policy, paxTable: preset.paxTable },
        },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ preset });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}
