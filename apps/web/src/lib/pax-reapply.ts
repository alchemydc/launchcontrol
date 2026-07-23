import type { PrismaClient } from "@/generated/prisma/client";
import { parseSeasonPaxTableStrict } from "@/lib/rmsolo-pax";

/**
 * Admin-initiated "re-apply factors" action for a single Season
 * (spec §PAX): stamps `Entry.paxIndexApplied` with the season's own
 * `paxTable` value for every entry whose `paxClass.code` is a key of that
 * table, scoped to events of THIS season only. A deliberate, bounded
 * history rewrite — codes not present in the table are left untouched
 * (e.g. AxWare/source-authoritative entries whose class isn't covered by
 * this season's override table stay frozen at whatever was stamped at
 * ingest), and `paxClass` is further scoped to the season's own league
 * since `CarClass.code` is only unique per-league, not globally.
 */
export async function reapplySeasonPaxFactors(
  client: PrismaClient,
  seasonId: number,
): Promise<{ updated: number; codes: string[] }> {
  const season = await client.season.findUniqueOrThrow({ where: { id: seasonId } });
  const table = parseSeasonPaxTableStrict(season.paxTable);
  const codes = Object.keys(table).sort();
  let updated = 0;
  await client.$transaction(async (tx) => {
    for (const code of codes) {
      const res = await tx.entry.updateMany({
        where: { event: { seasonId }, paxClass: { code, leagueId: season.leagueId } },
        data: { paxIndexApplied: table[code] },
      });
      updated += res.count;
    }
  });
  return { updated, codes };
}
