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
 * season navigates there too. Events is league-wide (all seasons) for now —
 * per-season event filtering is future work.
 *
 * Client component: active-tab highlighting and the current-season override
 * need `usePathname` (legacy paths like /leaderboard count as their scoped
 * equivalents).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const basePath = `/l/${slug}`;
  // Task 20: /l/[league]/drivers/[id] doesn't belong to either tab -- without
  // this, `onLeaderboard` falls out false there (its own path matches
  // neither branch below) and the Events tab lit up as a false-active match.
  const onDriverPage = pathname.startsWith(`${basePath}/drivers`);
  const onLeaderboard =
    !onDriverPage &&
    (pathname.startsWith(`${basePath}/leaderboard`) ||
      pathname.startsWith("/leaderboard"));
  // On a season-addressed page, the selector reflects THAT season rather
  // than the league's active one.
  const seasonMatch = pathname.match(
    new RegExp(`^${basePath}/leaderboard/s/([^/]+)`),
  );
  const currentSeasonSlug =
    (seasonMatch && seasonMatch[1]) ?? activeSeasonSlug ?? seasons[0]?.slug;
  const leaderboardHref = currentSeasonSlug
    ? `${basePath}/leaderboard/s/${currentSeasonSlug}`
    : `${basePath}/leaderboard`;

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
            />
          </div>
        )}
        <span aria-hidden className="text-border">
          |
        </span>
        <Link href={basePath} className={tabClass(!onLeaderboard && !onDriverPage)}>
          Events
        </Link>
        <Link href={leaderboardHref} className={tabClass(onLeaderboard)}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
