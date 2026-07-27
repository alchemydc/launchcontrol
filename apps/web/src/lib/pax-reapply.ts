import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { parseSeasonPaxTableStrict } from "@/lib/rmsolo-pax";

/**
 * Admin-initiated "re-apply factors" action for a single Season
 * (spec §PAX): stamps `Entry.paxIndexApplied` with the season's RULESET
 * `paxTable` value (Task R2 — the season itself no longer stores a table)
 * for every entry whose `paxClass.code` is a key of that table, scoped to
 * events of THIS season only. A deliberate, bounded history rewrite —
 * codes not present in the table are left untouched (e.g. entries whose
 * class isn't covered stay frozen at whatever was stamped at ingest), and
 * `paxClass` is further scoped to the season's own league since
 * `CarClass.code` is only unique per-league, not globally.
 */
export async function reapplySeasonPaxFactors(
  client: PrismaClient,
  seasonId: number,
  // Runs inside the same transaction, after the rewrite — used by the admin
  // route to make the audit row atomic with this history rewrite.
  inTx?: (tx: Prisma.TransactionClient, result: { updated: number; codes: string[] }) => Promise<void>,
): Promise<{ updated: number; codes: string[] }> {
  const season = await client.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: { ruleset: true },
  });
  const table = parseSeasonPaxTableStrict(season.ruleset.paxTable);
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
    await inTx?.(tx, { updated, codes });
  });
  return { updated, codes };
}
