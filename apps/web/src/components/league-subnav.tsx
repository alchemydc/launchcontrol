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
 * current season is visible from any league page. The Leaderboard tab links
 * to the SELECTED season's scoped address (`/l/[slug]/leaderboard/s/[slug]`)
 * so the standings you land on are never ambiguous; selecting a different
 * season navigates there too. The Events tab (Task 21) is per-season too:
 * selecting a season there pushes `${basePath}?season=<slug>` on the league
 * home instead, and the tab's own href preserves whatever `?season=` is
 * currently active so tab-switching doesn't silently drop the selection.
 *
 * Client component: active-tab highlighting and the current-season override
 * need `usePathname`/`useSearchParams` (legacy paths like /leaderboard count
 * as their scoped equivalents; the Events tab's season comes from the URL's
 * `?season=` query param rather than a path segment).
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
  // Task 20: /l/[league]/drivers/[id] doesn't belong to either tab -- without
  // this, `onLeaderboard` falls out false there (its own path matches
  // neither branch below) and the Events tab lit up as a false-active match.
  const onDriverPage = pathname.startsWith(`${basePath}/drivers`);
  const onLeaderboard =
    !onDriverPage &&
    (pathname.startsWith(`${basePath}/leaderboard`) ||
      pathname.startsWith("/leaderboard"));
  const onEvents = !onLeaderboard && !onDriverPage;
  // On a season-addressed leaderboard page, the selector reflects THAT
  // season; on the Events tab it reflects the `?season=` query param instead
  // (there's no path segment there), falling back to the league's active
  // season the same way the page itself does.
  const seasonMatch = pathname.match(
    new RegExp(`^${basePath}/leaderboard/s/([^/]+)`),
  );
  const eventsSeasonParam = searchParams?.get("season") ?? null;
  const currentSeasonSlug = onEvents
    ? (eventsSeasonParam ?? activeSeasonSlug ?? seasons[0]?.slug)
    : ((seasonMatch && seasonMatch[1]) ?? activeSeasonSlug ?? seasons[0]?.slug);
  const leaderboardHref = currentSeasonSlug
    ? `${basePath}/leaderboard/s/${currentSeasonSlug}`
    : `${basePath}/leaderboard`;
  // Preserve the active `?season=` selection when the Events tab link itself
  // is clicked (e.g. from the leaderboard tab) — otherwise switching tabs
  // would silently drop back to the league's default/active season.
  const eventsHref = eventsSeasonParam
    ? `${basePath}?season=${eventsSeasonParam}`
    : basePath;

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
              basePath={`${basePath}/leaderboard/s`}
              compact
              buildHref={onEvents ? (s) => `${basePath}?season=${s}` : undefined}
            />
          </div>
        )}
        <span aria-hidden className="text-border">
          |
        </span>
        <Link href={eventsHref} className={tabClass(onEvents)}>
          Events
        </Link>
        <Link href={leaderboardHref} className={tabClass(onLeaderboard)}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
