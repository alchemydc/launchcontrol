/**
 * Event-link composition for views that render builder-emitted event hrefs.
 *
 * Builders (season-leaderboard.ts, driver-history.ts) always emit a
 * league-RELATIVE suffix — `/events/[slug]` or `/events/combined/[date]` —
 * and views must prefix it with the page's league base path ("" on legacy
 * routes, "/l/[slug]" on league-scoped ones). Rendering the suffix verbatim
 * on an /l/[league] page resolves against the DEFAULT league's event slugs
 * and 404s for every other league.
 */
export function composeEventHref(basePath: string, hrefSuffix: string): string {
  return `${basePath}${hrefSuffix}`;
}

/**
 * Per-row variant for driver history — the one surface whose rows can span
 * leagues (legacy `/drivers/[id]?league=all`). A locked `/l/[league]` page
 * passes its own non-empty `basePath` and every row is guaranteed in-league
 * there (buildDriverHistory's scoped query; combined groups key on leagueId).
 * With no locked basePath, each row links into its OWN league: unprefixed
 * for the deployment default league (byte-identical to the legacy
 * rendering), `/l/[slug]`-prefixed for any other league.
 */
export function historyRowEventHref(
  row: { href: string; leagueSlug: string },
  basePath: string,
  defaultLeagueSlug: string,
): string {
  if (basePath !== "") return composeEventHref(basePath, row.href);
  return row.leagueSlug === defaultLeagueSlug
    ? row.href
    : `/l/${row.leagueSlug}${row.href}`;
}
