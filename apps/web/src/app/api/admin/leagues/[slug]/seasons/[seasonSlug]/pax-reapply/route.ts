import { guardLeagueAdmin } from "@/lib/admin-guard";
import { reapplySeasonPaxFactors } from "@/lib/pax-reapply";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; seasonSlug: string }> },
) {
  const { slug, seasonSlug } = await params;
  const g = await guardLeagueAdmin(slug);
  if (g instanceof Response) return g;

  const season = await prisma.season.findFirst({ where: { leagueId: g.league.id, slug: seasonSlug } });
  if (!season) {
    return Response.json({ error: "season not found" }, { status: 404 });
  }

  try {
    const res = await reapplySeasonPaxFactors(prisma, season.id);
    try {
      await writeAudit(prisma, {
        action: "season.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "season",
        targetSlug: seasonSlug,
        detail: { league: slug, season: seasonSlug, reapplied: res },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }
    return Response.json({ reapplied: res });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "re-apply failed" }, { status: 400 });
  }
}
