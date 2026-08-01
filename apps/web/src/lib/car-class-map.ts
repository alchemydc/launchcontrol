import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * The two CarClass fields the scoring paths read off an Entry: `code` (section
 * membership / display) and `paxIndex` (the live PAX factor, read only as
 * `appliedPaxIndex`'s fallback for pre-snapshot rows). `paxIndex` keeps its
 * `Prisma.Decimal` type so `driver-history`'s `{ toString(): string }` contract
 * and `season-leaderboard`'s looser `unknown` both accept it unchanged.
 */
export type CarClassRef = { code: string; paxIndex: Prisma.Decimal };

/**
 * One CarClass lookup for a whole page render, keyed by id.
 *
 * `Entry.classId` and `Entry.paxClassId` are two relations onto the SAME table,
 * so including both (`class: {...}, paxClass: {...}`) makes Prisma issue two
 * separate round trips per query tree — measured on both the season-leaderboard
 * and driver-history paths. Selecting the scalar ids and resolving them through
 * this map collapses that to one, which matters because every hop is a network
 * round trip to Turso rather than a local read.
 *
 * Cheap to over-fetch: the table is league-scale (46 rows across both leagues
 * today), and callers pass only the ids their entries actually reference.
 */
export async function loadCarClassMap(
  client: PrismaClient,
  ids: Iterable<number>,
): Promise<Map<number, CarClassRef>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const rows = await client.carClass.findMany({
    where: { id: { in: unique } },
    select: { id: true, code: true, paxIndex: true },
  });
  return new Map(rows.map((r) => [r.id, { code: r.code, paxIndex: r.paxIndex }]));
}

/**
 * Resolve an id through the map, failing loudly rather than silently scoring a
 * blank class. A miss means the Entry references a CarClass row that no longer
 * exists — a referential-integrity violation, not an expected state.
 */
export function requireCarClass(
  map: Map<number, CarClassRef>,
  id: number,
): CarClassRef {
  const found = map.get(id);
  if (!found) {
    throw new Error(`[car-class-map] no CarClass row for id=${id}`);
  }
  return found;
}
