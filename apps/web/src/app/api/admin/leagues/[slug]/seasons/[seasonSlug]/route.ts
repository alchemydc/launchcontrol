import { guardLeagueAdmin } from "@/lib/admin-guard";
import { updateSeason, type UpdateSeasonPatch } from "@/lib/create-season";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { expireResultsCache } from "@/lib/results-cache";

export const runtime = "nodejs";

const PATCH_KEYS = [
  "name",
  "slug",
  "year",
  "plannedEvents",
  "minimumEvents",
  "status",
  "rulesetId",
] as const satisfies readonly (keyof UpdateSeasonPatch)[];

const REMOVED_SCORING_KEYS = ["paxTable", "scoringPolicy"] as const;

function toPatch(body: Record<string, unknown>): UpdateSeasonPatch {
  const patch: UpdateSeasonPatch = {};
  for (const key of PATCH_KEYS) {
    if (!(key in body)) continue;
    // updateSeason validates status/slug/rulesetId itself; this only
    // narrows to the wire type, it does not re-validate values.
    (patch as Record<string, unknown>)[key] = body[key];
  }
  return patch;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; seasonSlug: string }> },
) {
  const { slug, seasonSlug } = await params;
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
  const requestBody = body as Record<string, unknown>;
  if (REMOVED_SCORING_KEYS.some((key) => key in requestBody)) {
    return Response.json(
      {
        error:
          "Season scoring fields can no longer be updated directly; edit the season's ruleset instead",
      },
      { status: 400 },
    );
  }
  const patch = toPatch(requestBody);

  try {
    // Mutation + audit row commit or roll back together.
    const season = await prisma.$transaction(async (tx) => {
      const updated = await updateSeason(tx, { leagueSlug: slug, seasonSlug }, patch);
      await writeAudit(tx, {
        action: "season.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "season",
        targetSlug: updated.slug,
        detail: { league: slug, season: updated.slug, patch: Object.keys(patch) },
      });
      return updated;
    });
    // Re-pointing a season's ruleset (or archiving it) changes published
    // standings immediately — expire the ISR cache to match.
    expireResultsCache();
    return Response.json({ season });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}
