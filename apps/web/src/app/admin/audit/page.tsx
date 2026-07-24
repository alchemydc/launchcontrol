import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { administeredLeagues } from "@/lib/admin";
import { isSuperUser } from "@/lib/super-user";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditFilterBar } from "./audit-filter-bar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audit log",
};

const MAX_ROWS = 200;

function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

/**
 * Extracts the `"league":"<slug>"` marker most admin actions stamp into
 * their audit `detail` JSON (league/season/preset/membership routes — see
 * `writeAudit` call sites). Returns `null` when absent or `detail` isn't
 * parseable JSON.
 */
function auditRowLeagueFromDetail(detail: string): string | null {
  try {
    const parsed: unknown = JSON.parse(detail);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).league === "string"
    ) {
      return (parsed as { league: string }).league;
    }
  } catch {
    // detail isn't JSON — no marker to find.
  }
  return null;
}

/**
 * Task 17 documented approximation: a row "belongs" to `slug` if its detail
 * JSON carries `"league":"<slug>"`, or it is a league-targeted row whose
 * `targetSlug` equals `slug` (covers `league.create`/`league.update`/
 * `league.delete`/`ingest-now`, whose `targetSlug` IS the league slug
 * already). Rows with neither — `event.update`/`event.delete`/`ingest`
 * (targetSlug is the *event* slug, not a league) and `superuser.update`
 * (targetSlug is an msrUid) — never match a specific league filter under
 * this heuristic. M4: the `targetSlug` branch is gated on
 * `targetType === "league"` so an event/season/membership slug that happens
 * to collide with a league slug can't leak that row across leagues.
 */
function auditRowMatchesLeague(
  row: { detail: string; targetSlug: string | null; targetType: string },
  slug: string,
): boolean {
  return (
    auditRowLeagueFromDetail(row.detail) === slug ||
    (row.targetType === "league" && row.targetSlug === slug)
  );
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const { league: leagueParam } = await searchParams;
  const session = await getSession();

  const [leagues, superUser, allRows] = await Promise.all([
    administeredLeagues(session.msrUid),
    isSuperUser(session.msrUid),
    prisma.adminAuditLog.findMany({
      orderBy: { id: "desc" },
      take: MAX_ROWS,
    }),
  ]);

  const administeredSlugs = leagues.map((l) => l.slug);
  const selectedLeague =
    leagueParam && administeredSlugs.includes(leagueParam) ? leagueParam : undefined;

  // Task 17: a league admin must never see another league's audit rows,
  // including in the default "all" view -- superuser default (no filter)
  // shows every fetched row (rows with no league marker at all, e.g. plain
  // event edits, are only ever visible to a superuser); a non-superuser's
  // default view keeps only rows attributable to one of THEIR administered
  // leagues, dropping unmarked rows rather than guessing.
  const rows = selectedLeague
    ? allRows.filter((row) => auditRowMatchesLeague(row, selectedLeague))
    : superUser
      ? allRows
      : allRows.filter((row) => administeredSlugs.some((slug) => auditRowMatchesLeague(row, slug)));

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <AuditFilterBar
          leagues={leagues.map((l) => ({ slug: l.slug, name: l.name }))}
          current={selectedLeague ?? "all"}
        />
        <p className="text-sm text-muted-foreground">
          Admin ingest, edit, and delete actions, most recent first
          {allRows.length === MAX_ROWS ? ` (showing the latest ${MAX_ROWS} overall)` : ""}.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatTimestamp(row.createdAt)}
                </TableCell>
                <TableCell className="font-medium">{row.action}</TableCell>
                <TableCell>{row.actorName}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.targetSlug ?? "—"}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      view
                    </summary>
                    <pre className="mt-2 max-w-md overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                      {prettyDetail(row.detail)}
                    </pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No admin actions recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
