import { guardLeagueAdmin } from "@/lib/admin-guard";
import { reapplySeasonPaxFactors } from "@/lib/pax-reapply";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { expireResultsCache } from "@/lib/results-cache";

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
    // The audit row rides inside reapplySeasonPaxFactors' own transaction —
    // this bounded history rewrite must not land without a durable record.
    const res = await reapplySeasonPaxFactors(prisma, season.id, async (tx, result) => {
      await writeAudit(tx, {
        action: "season.update",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "season",
        targetSlug: seasonSlug,
        detail: { league: slug, season: seasonSlug, reapplied: result },
      });
    });
    // PAX standings render on public pages — make the rewrite visible now.
    expireResultsCache();
    return Response.json({ reapplied: res });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "re-apply failed" }, { status: 400 });
  }
}
