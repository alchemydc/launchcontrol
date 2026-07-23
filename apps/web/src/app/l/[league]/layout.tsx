import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";

/**
 * Per-league <title>/<meta description> for the /l/[league] subtree — without
 * this, every league page inherited the root layout's metadata (the default
 * league's siteTitle/siteDescription), so a non-default league's browser tab
 * and search-result snippet carried the wrong league's branding. An unknown
 * slug returns no metadata override; the page-level notFound() below (and in
 * every nested page) still 404s the subtree the normal way.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league: slug } = await params;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) return {};
  return {
    title: { default: league.siteTitle, template: "%s · Launch Control" },
    description: league.siteDescription,
  };
}

/**
 * Guards every /l/[league]* route: 404s the whole subtree for an unknown
 * league slug up front, so nested pages don't each need to repeat the check.
 * `getLeagueConfigForSlug` is memoized per (slug, client) via React `cache()`,
 * so nested pages calling it again for the resolved config (branding, gate,
 * numeric id) share this same DB read rather than re-querying.
 */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ league: string }>;
}) {
  const { league: slug } = await params;
  const league = await getLeagueConfigForSlug(slug);
  if (!league) notFound();
  return <>{children}</>;
}
