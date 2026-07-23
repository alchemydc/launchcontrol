/**
 * League gate — the entry point for every deployment. Renders a responsive
 * grid of league cards (logo, name, one-liner, stat badges), each linking to
 * `/l/[slug]`. Used two places, unconditionally, including single-league
 * deployments (e.g. PCA production — a disclosed product change from the
 * pre-gate default league home that used to live at `/`):
 *
 *   - ROOT `/` — see app/page.tsx.
 *   - `/leagues` — see app/leagues/page.tsx (kept as an explicit alias).
 *
 * Always public: this page carries no gated content, only directory-level
 * info (name, logo, active season, event/driver counts); the league CONTENT
 * behind each card's link still respects that league's own gate.
 *
 * Role badges ("Admin"/"Member") render only when a session exists AND the
 * viewer holds a LeagueMembership row for that league. Deployments with no
 * SESSION_SECRET configured (login-less) skip the session read entirely and
 * render no role badges — this page must stay reachable even when session
 * infrastructure isn't set up.
 */

import Link from "next/link";
import { getSession } from "@/lib/session";
import { listLeagueDirectory, type LeagueDirectoryEntry } from "@/lib/league-directory";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";

const PLACEHOLDER_PALETTE = [
  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
] as const;

/** Deterministic (non-cryptographic) hash — only used to pick a stable placeholder color/initials per slug. */
function hashSlug(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function placeholderPalette(slug: string): string {
  return PLACEHOLDER_PALETTE[hashSlug(slug) % PLACEHOLDER_PALETTE.length] ?? PLACEHOLDER_PALETTE[0];
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Per-league viewer role, keyed by league id — `null` when no session (or no
 * SESSION_SECRET configured) rather than doing a per-league membership
 * lookup for an anonymous viewer. Small-N (single-digit league counts), same
 * trade-off as `listLeagueDirectory`'s per-league queries.
 */
async function resolveViewerRoles(
  leagues: LeagueDirectoryEntry[],
): Promise<Map<number, string>> {
  const roles = new Map<number, string>();

  // getSession() requires SESSION_SECRET (>= 32 chars) or throws — guard so
  // login-less deployments can still render this public page.
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return roles;

  const session = await getSession();
  const msrUid = session.msrUid;
  if (!msrUid) return roles;

  await Promise.all(
    leagues.map(async (league) => {
      const membership = await prisma.leagueMembership.findUnique({
        where: { leagueId_msrUid: { leagueId: league.id, msrUid } },
      });
      if (membership) roles.set(league.id, membership.role);
    }),
  );

  return roles;
}

function roleBadge(role: string | undefined): React.ReactNode {
  if (!role) return null;
  const label = role === "ADMIN" ? "Admin" : "Member";
  return (
    <Badge variant={role === "ADMIN" ? "default" : "secondary"}>{label}</Badge>
  );
}

export async function LeagueGate() {
  const leagues = await listLeagueDirectory();
  const roles = await resolveViewerRoles(leagues);

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          Directory
        </p>
        <div className="flex items-start gap-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Leagues
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Every league hosted on this Launch Control deployment.
            </p>
          </div>
        </div>
      </header>

      {leagues.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">No leagues configured yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {leagues.map((league) => (
            <Link
              key={league.slug}
              href={`/l/${league.slug}`}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="relative aspect-[16/10] w-full bg-muted/40 flex items-center justify-center overflow-hidden">
                {league.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- league logos are arbitrary operator-supplied URLs, not part of the app's optimized asset set.
                  <img
                    src={league.logoUrl}
                    alt={`${league.name} logo`}
                    className="h-full w-full object-contain p-6"
                  />
                ) : (
                  <div
                    className={`flex h-full w-full items-center justify-center text-4xl font-semibold tracking-tight ${placeholderPalette(league.slug)}`}
                  >
                    {initials(league.name)}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 p-4">
                <h2 className="font-heading text-base font-medium leading-snug group-hover:text-primary transition-colors">
                  {league.name}
                </h2>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {league.siteDescription}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {league.activeSeasonName && (
                    <Badge variant="secondary">{league.activeSeasonName}</Badge>
                  )}
                  <Badge variant="outline">{league.eventCount} events</Badge>
                  <Badge variant="outline">{league.driverCount} drivers</Badge>
                  {roleBadge(roles.get(league.id))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
