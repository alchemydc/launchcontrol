import { LeagueGate } from "@/components/league-gate";

export const dynamic = "force-dynamic";

/**
 * `/leagues` — the league gate, always rendered. Kept as an explicit alias
 * to ROOT `/` (see app/page.tsx, which renders the same gate) so the gate
 * has a stable, memorable URL independent of `/`.
 */
export default async function LeaguesPage() {
  return <LeagueGate />;
}
