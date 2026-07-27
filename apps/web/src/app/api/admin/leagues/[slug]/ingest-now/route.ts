import { guardLeagueAdmin } from "@/lib/admin-guard";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { expireResultsCache } from "@/lib/results-cache";

// The shared scrape lib shells out to pdftotext (execFileSync) — force nodejs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand RMsolo scrape for one league. Guard (404 fail-closed like every
 * league admin route) → capability gate (501 + reason when disabled) →
 * per-league in-process mutex (409 when a run is already in flight) → run →
 * best-effort audit → JSON counts.
 *
 * The scrape lib is imported DYNAMICALLY inside the handler so a serverless
 * build never statically bundles its child-process (pdftotext) path.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const g = await guardLeagueAdmin(slug);
  if (g instanceof Response) return g;

  const { ingestNowCapability, acquireIngestLock, runRmsoloIngest } = await import("@/lib/rmsolo-run");

  const cap = ingestNowCapability();
  if (!cap.enabled) {
    return Response.json(
      { error: cap.reason ?? "on-demand ingest is not available on this deployment" },
      { status: 501 },
    );
  }

  const release = acquireIngestLock(g.league.slug);
  if (!release) {
    return Response.json(
      { error: "an ingest is already running for this league — try again shortly" },
      { status: 409 },
    );
  }

  try {
    // Actor threads through to the per-event "ingest" audit rows so they
    // record the admin who clicked, not "cli".
    const counts = await runRmsoloIngest({
      leagueSlug: g.league.slug,
      client: prisma,
      actor: { msrUid: g.actor.msrUid, name: g.actor.name },
    });
    // New events/runs render on public pages — expire the ISR cache so the
    // admin's success response matches what visitors see.
    expireResultsCache();
    try {
      await writeAudit(prisma, {
        action: "ingest.now",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "league",
        targetId: g.league.id,
        targetSlug: g.league.slug,
        detail: { league: g.league.slug, ...counts },
      });
    } catch (e) {
      console.error("[ingest-now] audit write failed", e);
    }
    return Response.json(counts);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "ingest failed" },
      { status: 500 },
    );
  } finally {
    release();
  }
}
