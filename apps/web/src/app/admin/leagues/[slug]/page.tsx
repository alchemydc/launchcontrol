import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/session";
import { isLeagueAdmin } from "@/lib/admin";
import { isSuperUser } from "@/lib/super-user";
import { prisma } from "@/lib/prisma";
import { LeagueSettingsForm } from "./league-settings-form";
import { IngestNowButton } from "./ingest-now-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const league = await prisma.league.findUnique({ where: { slug } });
  return { title: league ? `Admin · ${league.name}` : "Admin" };
}

export default async function AdminLeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const league = await prisma.league.findUnique({ where: { slug } });
  if (!league) notFound();

  const session = await getSession();
  // admin/layout.tsx only checks isAnyLeagueAdmin (admin of ANY league) —
  // re-check THIS league specifically before rendering its settings.
  if (!(await isLeagueAdmin(session.msrUid, league.id))) notFound();

  const canDelete = await isSuperUser(session.msrUid);

  // Dynamic import so the page's static graph never pulls in the scrape lib's
  // child-process (pdftotext) path. Capability-only gating for now: a league
  // without an RMsolo source (e.g. a PCA .axdb league) would still see the
  // button on an INGEST_NOW_ENABLED deployment — acceptable for the MVP, since
  // the flag is only set on RMsolo Docker deployments.
  const { ingestNowCapability } = await import("@/lib/rmsolo-run");
  const canIngestNow = ingestNowCapability().enabled;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div>
          <p className="text-sm text-muted-foreground font-mono">{league.slug}</p>
          <h1 className="text-xl font-semibold">{league.name}</h1>
        </div>

        <LeagueSettingsForm
          league={{
            slug: league.slug,
            name: league.name,
            siteTitle: league.siteTitle,
            siteDescription: league.siteDescription,
            footerText: league.footerText,
            landingDescription: league.landingDescription,
            accessGate: league.accessGate as "required" | "optional" | "none",
            logoUrl: league.logoUrl,
            msrOrgId: league.msrOrgId,
            smugmugUser: league.smugmugUser,
            smugmugDisciplinePath: league.smugmugDisciplinePath,
          }}
          canDelete={canDelete}
        />

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Manage
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link href={`/admin/leagues/${league.slug}/seasons`}>
              <Card className="cursor-pointer hover:border-primary/40 transition-colors h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Seasons
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Seasons, event counts, and PAX re-apply.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/admin/leagues/${league.slug}/presets`}>
              <Card className="cursor-pointer hover:border-primary/40 transition-colors h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Rulesets
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Scoring rulesets seasons snapshot from.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/admin/leagues/${league.slug}/members`}>
              <Card className="cursor-pointer hover:border-primary/40 transition-colors h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Admins &amp; access
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Grant league admins; manual access overrides.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {canIngestNow && (
          <Card>
            <CardHeader>
              <CardTitle>Ingest now</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Fetch the latest RMsolo results for this league on demand. Already-ingested events
                are skipped by content hash, so re-running is safe.
              </p>
              <IngestNowButton slug={league.slug} />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
