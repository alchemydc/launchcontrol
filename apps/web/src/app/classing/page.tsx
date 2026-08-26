import { getLeagueConfig } from "@/lib/league-config";
import { DefaultLeagueSubnav } from "@/components/default-league-subnav";
import { ClassingPageView } from "@/app/l/[league]/classing/classing-page-view";

export const revalidate = 300;

/**
 * Legacy alias for the DEFAULT league's classing guide, matching /leaderboard
 * and /events/[slug]. Gives the club a short, stable URL to link from its own
 * site in place of the static generated page.
 *
 * Public, like its scoped counterpart — no gate call.
 */
export default async function ClassingPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const league = await getLeagueConfig();

  return (
    <>
      <DefaultLeagueSubnav />
      <ClassingPageView league={league} seasonSlug={season} />
    </>
  );
}
