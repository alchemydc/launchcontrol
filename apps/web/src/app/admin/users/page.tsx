import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { isSuperUser, superUserEnvAllowlist } from "@/lib/super-user";
import { prisma } from "@/lib/prisma";
import type { MembershipRole } from "@/lib/membership";
import { UsersTable, type MembershipGroup, type SuperUserRow } from "./users-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Users",
};

export default async function AdminUsersPage() {
  const session = await getSession();
  // admin/layout.tsx only checks isAnyLeagueAdmin (superuser OR admin of ANY
  // league) — this page is superuser-only, so re-check that specifically.
  if (!(await isSuperUser(session.msrUid))) notFound();

  const [leagues, superUserRows] = await Promise.all([
    prisma.league.findMany({
      orderBy: { name: "asc" },
      include: { memberships: { orderBy: [{ role: "asc" }, { msrUid: "asc" }] } },
    }),
    prisma.superUser.findMany({ orderBy: { msrUid: "asc" } }),
  ]);

  const groups: MembershipGroup[] = leagues.map((league) => ({
    leagueSlug: league.slug,
    leagueName: league.name,
    members: league.memberships.map((m) => ({
      msrUid: m.msrUid,
      role: m.role as MembershipRole,
    })),
  }));

  // Union of the env allowlist and DB rows — a UID can appear in both (a row
  // is harmless but redundant once a UID is env-listed). Whether it's
  // revocable is governed by env membership alone (setSuperUser() refuses to
  // revoke any env-listed UID regardless of whether a row also exists), so
  // that's what "source" reflects here, not mere row presence.
  const envAllowlist = superUserEnvAllowlist();
  const allUids = Array.from(
    new Set([...envAllowlist, ...superUserRows.map((s) => s.msrUid)]),
  ).sort();
  const superUsers: SuperUserRow[] = allUids.map((msrUid) => ({
    msrUid,
    source: envAllowlist.includes(msrUid) ? "env" : "row",
  }));

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-4xl flex flex-col gap-4">
        <div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Admin
          </Link>
          <h1 className="text-xl font-semibold mt-1">Users</h1>
        </div>

        <UsersTable groups={groups} superUsers={superUsers} />
      </div>
    </main>
  );
}
