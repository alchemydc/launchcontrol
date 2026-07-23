import { LeagueGate } from "@/components/league-gate";

export const dynamic = "force-dynamic";

/**
 * `/leagues` — the league gate, always rendered (regardless of league
 * count). Kept as its own route/alias to ROOT `/`'s multi-league gate
 * codepath (see app/page.tsx's `shouldShowLeagueGate` branch) so the gate
 * stays reachable directly even on single-league deployments.
 */
export default async function LeaguesPage() {
  return <LeagueGate />;
}
