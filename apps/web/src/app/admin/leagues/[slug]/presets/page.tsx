import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { isLeagueAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { parseScoringPolicy } from "@/lib/scoring-policy";
import { PresetsTable, type PresetRow } from "./presets-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const league = await prisma.league.findUnique({ where: { slug } });
  return { title: league ? `Scoring rulesets · ${league.name}` : "Scoring rulesets" };
}

export default async function AdminPresetsPage({
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

  const presets = await prisma.scoringSystem.findMany({
    where: { leagueId: league.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const rows: PresetRow[] = presets.map((preset) => {
    // Every row written via createScoringSystem/updateScoringSystem is
    // pre-validated, so this should never throw — but a hand-edited row is
    // still just data, not something that should crash the whole page.
    let policy = null;
    try {
      policy = parseScoringPolicy(preset.policy);
    } catch {
      policy = null;
    }
    return { id: preset.id, name: preset.name, policy };
  });

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
          <h1 className="text-xl font-semibold mt-1">Scoring rulesets</h1>
        </div>

        <PresetsTable leagueSlug={league.slug} rows={rows} />
      </div>
    </main>
  );
}
