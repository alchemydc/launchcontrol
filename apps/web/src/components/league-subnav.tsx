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
 * standings (`/l/[slug]/leaderboard/s/[season]`); on the Events tab (Task 21)
 * it drives the `?season=`-filtered event list, pushing `${basePath}?season=<slug>`
 * on the league home. Switching tabs preserves the selected season (in both
 * directions), so the two tabs always agree on which season you're looking at.
 *
 * Client component: active-tab highlighting, the current-season override, and
 * reading the events tab's `?season=` need `usePathname`/`useSearchParams`
 * (legacy paths like /leaderboard count as their scoped equivalents; the
 * Events tab's season comes from the URL's `?season=` query param rather than
 * a path segment). Every route mounting this subnav is force-dynamic, so
 * `useSearchParams` needs no Suspense boundary (that requirement is
 * prerendered-route-only).
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LeagueSeasonSwitcher } from "@/components/league-season-switcher";

export function LeagueSubnav({
  slug,
  name,
  seasons,
  activeSeasonSlug,
  hasClassing = false,
}: {
  slug: string;
  name: string;
  seasons: Array<{ slug: string; name: string }>;
  activeSeasonSlug: string | null;
  /** Classing rules are league-specific; leagues without a model get no tab. */
  hasClassing?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const basePath = `/l/${slug}`;
  // Task 20: /l/[league]/drivers/[id] doesn't belong to either tab -- without
  // this, `onLeaderboard` falls out false there (its own path matches
  // neither branch below) and the Events tab lit up as a false-active match.
  const onDriverPage = pathname.startsWith(`${basePath}/drivers`);
  const onClassing =
    !onDriverPage &&
    (pathname.startsWith(`${basePath}/classing`) || pathname.startsWith("/classing"));
  const onLeaderboard =
    !onDriverPage &&
    !onClassing &&
    (pathname.startsWith(`${basePath}/leaderboard`) ||
      pathname.startsWith("/leaderboard"));
  // Events remains the fallthrough tab, so every new tab above must exclude
  // itself here too or it would light Events up alongside itself.
  const onEvents = !onLeaderboard && !onDriverPage && !onClassing;
  // On a season-addressed leaderboard page, the selector reflects THAT
  // season; on the Events tab it reflects the `?season=` query param instead
  // (there's no path segment there), falling back to the league's active
  // season the same way the page itself does.
  const seasonMatch = pathname.match(
    new RegExp(`^${basePath}/leaderboard/s/([^/]+)`),
  );
  const querySeasonParam = searchParams?.get("season") ?? null;
  // A slug from the URL is only usable if this league actually has it. The
  // pages fall back to the active season for an unknown `?season=`, so without
  // this check the switcher would display a bogus slug over active-season
  // content — and keep propagating it into every tab link it builds.
  const known = (slug: string | null | undefined) =>
    slug != null && seasons.some((s) => s.slug === slug) ? slug : null;
  // Classing addresses its season the same way the Events tab does (`?season=`,
  // no path segment), so both read the query param rather than the path.
  const urlSeasonSlug =
    onEvents || onClassing ? querySeasonParam : ((seasonMatch && seasonMatch[1]) ?? null);
  const currentSeasonSlug =
    known(urlSeasonSlug) ?? activeSeasonSlug ?? seasons[0]?.slug;
  const leaderboardHref = currentSeasonSlug
    ? `${basePath}/leaderboard/s/${currentSeasonSlug}`
    : `${basePath}/leaderboard`;
  // Preserve the currently-viewed season when the Events tab link itself is
  // clicked (e.g. from a season-addressed leaderboard path) — otherwise
  // tab-switching would silently drop back to the league's active season.
  // Derive from currentSeasonSlug (which reflects the leaderboard path segment
  // or the events query param), but only emit `?season=` when it differs from
  // the active season, so the default view keeps a clean base path.
  const eventsHref =
    currentSeasonSlug && currentSeasonSlug !== activeSeasonSlug
      ? `${basePath}?season=${currentSeasonSlug}`
      : basePath;
  const classingHref =
    currentSeasonSlug && currentSeasonSlug !== activeSeasonSlug
      ? `${basePath}/classing?season=${currentSeasonSlug}`
      : `${basePath}/classing`;

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
              buildHref={
                onClassing
                  ? (s) => `${basePath}/classing?season=${s}`
                  : onEvents
                    ? (s) => `${basePath}?season=${s}`
                    : undefined
              }
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
        {hasClassing && (
          <Link href={classingHref} className={tabClass(onClassing)}>
            Classing
          </Link>
        )}
      </div>
    </div>
  );
}
