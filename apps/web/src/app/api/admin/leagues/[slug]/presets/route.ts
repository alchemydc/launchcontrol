import { guardLeagueAdmin } from "@/lib/admin-guard";
import { createScoringSystem, updateScoringSystem } from "@/lib/scoring-system";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { expireResultsCache } from "@/lib/results-cache";

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

  const name = b.name;
  const policyJson = b.policyJson;
  try {
    // Mutation + audit row commit or roll back together.
    const preset = await prisma.$transaction(async (tx) => {
      const created = await createScoringSystem(tx, {
        leagueSlug: slug,
        name,
        policyJson,
        paxTableJson,
      });
      await writeAudit(tx, {
        action: "preset.create",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "scoringSystem",
        targetSlug: slug,
        detail: {
          league: slug,
          name: created.name,
          after: { policy: created.policy, paxTable: created.paxTable },
        },
      });
      return created;
    });
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

  try {
    // Mutation + audit row commit or roll back together. The pre-update
    // snapshot rides in the same transaction so it can't race a concurrent
    // edit: since Task R2 a ruleset is a LIVE reference for every season
    // pointing at it, so an edit here changes standings retroactively — the
    // log must show what the scoring config was before, not just that
    // "policy" was patched.
    const preset = await prisma.$transaction(async (tx) => {
      const before = await tx.scoringSystem.findFirst({
        where: { league: { slug }, name },
        select: { policy: true, paxTable: true },
      });
      const updated = await updateScoringSystem(tx, { leagueSlug: slug, name }, patch);
      await writeAudit(tx, {
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
          after: { policy: updated.policy, paxTable: updated.paxTable },
        },
      });
      return updated;
    });
    // Rulesets are read live by season standings — expire the ISR cache so
    // the retroactive scoring change is visible now, not in five minutes.
    expireResultsCache();
    return Response.json({ preset });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}
