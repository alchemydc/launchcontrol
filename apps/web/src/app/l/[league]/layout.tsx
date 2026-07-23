import { notFound } from "next/navigation";
import { getLeagueConfigForSlug } from "@/lib/league-config";

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
