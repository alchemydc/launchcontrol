import { guardLeagueAdmin } from "@/lib/admin-guard";
import { createSeason, type CreateSeasonOptions } from "@/lib/create-season";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * The created season points at a ScoringSystem ruleset (live reference —
 * Task R2): the league's default (oldest) ruleset unless `presetName` names
 * an existing one.
 */
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
  if (typeof b.year !== "number" || !Number.isInteger(b.year)) {
    return Response.json({ error: "year must be an integer" }, { status: 400 });
  }

  const opts: CreateSeasonOptions = { leagueSlug: slug, name: b.name, year: b.year };
  if (typeof b.plannedEvents === "number") opts.plannedEvents = b.plannedEvents;
  if (typeof b.minimumEvents === "number") opts.minimumEvents = b.minimumEvents;
  if (typeof b.slug === "string") opts.slug = b.slug;
  if (typeof b.presetName === "string") opts.presetName = b.presetName;

  try {
    const season = await createSeason(opts, prisma);
    try {
      await writeAudit(prisma, {
        action: "season.create",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "season",
        targetSlug: season.slug,
        detail: { league: slug, season: season.slug },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ season }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}
