import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { isLeagueAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import type { MembershipRole } from "@/lib/membership";
import { MembersTable, type MemberRow } from "./members-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const league = await prisma.league.findUnique({ where: { slug } });
  return { title: league ? `Admins · ${league.name}` : "Admins" };
}

export default async function AdminMembersPage({
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

  const memberships = await prisma.leagueMembership.findMany({
    where: { leagueId: league.id },
    orderBy: [{ role: "asc" }, { msrUid: "asc" }],
  });

  // LeagueMembership has no createdAt column — nothing to omit-if-absent
  // here, this is simply every field the row has.
  const rows: MemberRow[] = memberships.map((m) => ({
    msrUid: m.msrUid,
    role: m.role as MembershipRole,
  }));

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-3xl flex flex-col gap-4">
        <div>
          <Link
            href={`/admin/leagues/${league.slug}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {league.name}
          </Link>
          <h1 className="text-xl font-semibold mt-1">Admins &amp; access</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-prose">
            Membership itself comes from MotorsportReg — anyone whose MSR account matches this
            league&apos;s club org is admitted automatically at login, with no row needed here. Use
            this page to grant <span className="font-medium">admin</span> rights, and only reach for
            manual member/blocked entries to override the MSR-based rule (grant someone without an
            org match, or block someone who has one).
          </p>
        </div>

        <MembersTable leagueSlug={league.slug} rows={rows} />
      </div>
    </main>
  );
}
