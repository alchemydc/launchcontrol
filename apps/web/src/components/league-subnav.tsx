"use client";

/**
 * League subnav — the Events/Leaderboard links and season selector, shown
 * WITH the league they belong to. Replaces the old header-nav results links,
 * which carried no indication of which league's results they pointed at once
 * a second league existed. Rendered by the /l/[league] layout (league-scoped
 * pages) and by DefaultLeagueSubnav on the legacy alias routes, where the
 * links target the default league's scoped paths.
 *
 * The season selector sits directly after the league name — it IS the
 * context the tabs operate in, and renders even for a single season so the
 * current season is visible from any league page. It is the SINGLE season
 * control for the league: on the Leaderboard tab it drives the season-scoped
 * standings (`/l/[slug]/leaderboard/s/[season]`); on the Events tab it drives
 * the `?season=`-filtered event list. Switching tabs preserves the selected
 * season, so the two tabs always agree on which season you're looking at.
 *
 * Client component: active-tab highlighting, the current-season override, and
 * reading the events tab's `?season=` need `usePathname`/`useSearchParams`
 * (legacy paths like /leaderboard count as their scoped equivalents). Every
 * route mounting this subnav is force-dynamic, so `useSearchParams` needs no
 * Suspense boundary (that requirement is prerendered-route-only).
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LeagueSeasonSwitcher } from "@/components/league-season-switcher";

export function LeagueSubnav({
  slug,
  name,
  seasons,
  activeSeasonSlug,
}: {
  slug: string;
  name: string;
  seasons: Array<{ slug: string; name: string }>;
  activeSeasonSlug: string | null;
}) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const basePath = `/l/${slug}`;
  const onLeaderboard =
    pathname.startsWith(`${basePath}/leaderboard`) ||
    pathname.startsWith("/leaderboard");
  // The selector reflects whichever season the current tab is scoped to: the
  // leaderboard path's `s/[season]` segment, else the events tab's `?season=`,
  // else the league's active season (first as a last resort).
  const seasonMatch = pathname.match(
    new RegExp(`^${basePath}/leaderboard/s/([^/]+)`),
  );
  const currentSeasonSlug =
    (seasonMatch && seasonMatch[1]) ??
    searchParams.get("season") ??
    activeSeasonSlug ??
    seasons[0]?.slug;
  const leaderboardHref = currentSeasonSlug
    ? `${basePath}/leaderboard/s/${currentSeasonSlug}`
    : `${basePath}/leaderboard`;
  const eventsHref = currentSeasonSlug
    ? `${basePath}?season=${currentSeasonSlug}`
    : basePath;
  // The one selector drives whichever tab is showing, keeping the season in
  // sync when you move between Events and Leaderboard.
  const buildSeasonHref = onLeaderboard
    ? (s: string) => `${basePath}/leaderboard/s/${s}`
    : (s: string) => `${basePath}?season=${s}`;

  const tabClass = (active: boolean) =>
    `border-b-2 px-1 py-2 text-sm transition-colors ${
      active
        ? "border-primary font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="border-b border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-0 px-4 sm:px-6">
        <Link
          href={basePath}
          className="py-2 text-sm font-semibold tracking-tight text-foreground"
        >
          {name}
        </Link>
        {seasons.length > 0 && currentSeasonSlug && (
          <div className="py-1.5">
            <LeagueSeasonSwitcher
              seasons={seasons}
              currentSlug={currentSeasonSlug}
              buildHref={buildSeasonHref}
              compact
            />
          </div>
        )}
        <span aria-hidden className="text-border">
          |
        </span>
        <Link href={eventsHref} className={tabClass(!onLeaderboard)}>
          Events
        </Link>
        <Link href={leaderboardHref} className={tabClass(onLeaderboard)}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
