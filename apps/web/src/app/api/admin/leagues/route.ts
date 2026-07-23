import { guardAnyLeagueAdmin } from "@/lib/admin-guard";
import { createLeague, type AccessGate, type CreateLeagueOptions } from "@/lib/create-league";
import { setLeagueMembership } from "@/lib/membership";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// createLeague (transitively, via create-league.ts's `readFileSync`) needs Node APIs.
export const runtime = "nodejs";

/**
 * League creation is intentionally NOT allowed to point `--policy-file` at
 * an arbitrary server path over the REST surface (unlike the CLI) — a
 * caller only ever gets `createLeague`'s built-in default policy, or a
 * named preset via `presetName` after the fact. Every other
 * `CreateLeagueOptions` field is pass-through.
 */
export async function POST(request: Request) {
  const g = await guardAnyLeagueAdmin();
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

  if (typeof b.slug !== "string" || b.slug.trim().length === 0) {
    return Response.json({ error: "slug must be a non-empty string" }, { status: 400 });
  }
  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
  }

  const opts: CreateLeagueOptions = { slug: b.slug, name: b.name };
  if (typeof b.title === "string") opts.title = b.title;
  if (typeof b.description === "string") opts.description = b.description;
  if (b.footer === null || typeof b.footer === "string") opts.footer = b.footer;
  if (typeof b.landing === "string") opts.landing = b.landing;
  if (typeof b.gate === "string") opts.gate = b.gate as AccessGate; // validated inside createLeague
  if (typeof b.presetName === "string") opts.presetName = b.presetName;
  if (b.logoUrl === null || typeof b.logoUrl === "string") opts.logoUrl = b.logoUrl;

  try {
    const { league, scoringSystemName } = await createLeague(opts, prisma);

    // Auto-ADMIN the creator on their new league — not best-effort: a
    // league created without its creator able to administer it is a bug,
    // not a logging hiccup, so a failure here surfaces as a real error.
    await setLeagueMembership(prisma, { leagueId: league.id, msrUid: g.actor.msrUid, role: "ADMIN" });

    try {
      await writeAudit(prisma, {
        action: "league.create",
        actorMsrUid: g.actor.msrUid,
        actorName: g.actor.name,
        targetType: "league",
        targetSlug: league.slug,
        detail: { league: league.slug, scoringSystemName },
      });
    } catch (e) {
      console.error("audit write failed", e);
    }

    return Response.json(
      { league: { slug: league.slug, name: league.name }, scoringSystemName },
      { status: 201 },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}
