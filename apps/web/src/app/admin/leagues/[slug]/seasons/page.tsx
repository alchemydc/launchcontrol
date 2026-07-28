import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { isLeagueAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { SeasonsTable, type SeasonRow } from "./seasons-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const league = await prisma.league.findUnique({ where: { slug } });
  return { title: league ? `Seasons · ${league.name}` : "Seasons" };
}

export default async function AdminSeasonsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const league = await prisma.league.findUnique({ where: { slug } });
  if (!league) notFound();

  const session = await getSession();
  // admin/layout.tsx only checks isAnyLeagueAdmin (admin of ANY league) —
  // re-check THIS league specifically, same as the league dashboard page.
  if (!(await isLeagueAdmin(session.msrUid, league.id))) notFound();

  const [seasons, presets] = await Promise.all([
    prisma.season.findMany({
      where: { leagueId: league.id },
      orderBy: [{ year: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { events: true } },
        ruleset: { select: { id: true, name: true } },
      },
    }),
    prisma.scoringSystem.findMany({
      where: { leagueId: league.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: SeasonRow[] = seasons.map((season) => ({
    id: season.id,
    name: season.name,
    slug: season.slug,
    year: season.year,
    plannedEvents: season.plannedEvents,
    minimumEvents: season.minimumEvents,
    status: season.status as "active" | "completed",
    rulesetId: season.ruleset.id,
    rulesetName: season.ruleset.name,
    events: season._count.events,
  }));

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <div>
          <Link
            href={`/admin/leagues/${league.slug}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {league.name}
          </Link>
          <h1 className="text-xl font-semibold mt-1">Seasons</h1>
        </div>

        <SeasonsTable
          leagueSlug={league.slug}
          rows={rows}
          presets={presets.map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </main>
  );
}
