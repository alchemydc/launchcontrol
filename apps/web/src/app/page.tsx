import { LeagueGate } from "@/components/league-gate";

export const dynamic = "force-dynamic";

/**
 * ROOT `/` — always the league gate (card grid), for every deployment,
 * including single-league ones (e.g. PCA production).
 *
 * PRODUCT CHANGE (disclosed, intentional): prior to this, single-league
 * deployments kept `/` byte-identical to the pre-gate default league home
 * page (EventsHome/Landing). The product owner asked for a uniform entry
 * experience instead — `/` is now the gate unconditionally. That league's
 * own home (the old `/` content, including its accessGate/Landing logic)
 * still lives at `/l/[slug]` (see app/l/[league]/page.tsx) and is unchanged.
 *
 * Legacy back-compat routes (`/leaderboard`, `/events/[slug]`,
 * `/drivers/[id]`) are NOT redirected — they keep serving the default
 * league directly, same as before.
 */
export default async function HomePage() {
  return <LeagueGate />;
}
