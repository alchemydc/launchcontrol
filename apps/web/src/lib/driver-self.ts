/**
 * Resolve the signed-in MSR user to their own `Driver` row.
 *
 * `Driver.msrUid` has been a unique column since the first migration but had
 * no write path until now — this module is it. Two keys, in priority order:
 *
 *   1. `Driver.msrUid` — an explicit link, written once at login by
 *      `claimSelfDriver`. Authoritative, and survives a later MSR name change.
 *   2. `Driver.nameOnlyHash` — sha256 of the full name (`computeNameOnlyHash`
 *      in lib/pii), which ingest already stamps on every Driver row and the
 *      OAuth callback computes from the MSR profile. Matched only when
 *      EXACTLY ONE Driver carries the hash, mirroring ingest's own
 *      merge/adopt rule: 0 or >=2 candidates means we don't guess.
 *
 * Reads and writes are deliberately split. `resolveSelfDriver` is pure read,
 * so rendering /me carries no side effect; the single write lives in
 * `claimSelfDriver`, called from the OAuth callback.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

export type SelfDriver =
  /** This viewer's Driver row. */
  | { status: "linked"; driverId: number; firstName: string; lastInitial: string }
  /** No hash match, or an ambiguous one — nothing to link, and we won't guess. */
  | { status: "unmatched" }
  /**
   * Session predates `nameOnlyHash` (30-day cookie) so there is no key to
   * match on. Distinct from "unmatched" because the fix is a re-login, not an
   * admin.
   */
  | { status: "unlinkable" };

/** The session fields resolution needs — keeps callers testable. */
export type SelfSession = Pick<SessionData, "msrUid" | "nameOnlyHash">;

/**
 * Find the Driver row belonging to `session`. Read-only: a match found via
 * `nameOnlyHash` is NOT persisted here (the next login does that), so this is
 * safe to call from a server component.
 */
export async function resolveSelfDriver(
  session: SelfSession,
  client: PrismaClient = prisma,
): Promise<SelfDriver> {
  if (!session.msrUid) return { status: "unmatched" };

  const linked = await client.driver.findUnique({
    where: { msrUid: session.msrUid },
    select: { id: true, firstName: true, lastInitial: true },
  });
  if (linked) {
    return {
      status: "linked",
      driverId: linked.id,
      firstName: linked.firstName,
      lastInitial: linked.lastInitial,
    };
  }

  if (!session.nameOnlyHash) return { status: "unlinkable" };

  // take: 2 is all we need — one row means a confident match, two means
  // ambiguity, and we treat both ">=2" cases identically.
  const candidates = await client.driver.findMany({
    where: { nameOnlyHash: session.nameOnlyHash },
    select: { id: true, firstName: true, lastInitial: true },
    take: 2,
  });
  if (candidates.length !== 1) return { status: "unmatched" };

  const only = candidates[0]!;
  return {
    status: "linked",
    driverId: only.id,
    firstName: only.firstName,
    lastInitial: only.lastInitial,
  };
}

/**
 * Best-effort write of `Driver.msrUid` for a user who just logged in. Called
 * only from the OAuth callback.
 *
 * Never throws: a failure here must not break a login, and the read path
 * resolves by `nameOnlyHash` regardless, so the link is an optimization plus
 * durability against a later name change.
 */
export async function claimSelfDriver(
  msrUid: string,
  nameOnlyHash: string,
  client: PrismaClient = prisma,
): Promise<void> {
  try {
    // Already linked — nothing to do, and re-claiming would fight the unique
    // constraint if this user's name now hashes to a different row.
    const existing = await client.driver.findUnique({
      where: { msrUid },
      select: { id: true },
    });
    if (existing) return;

    const candidates = await client.driver.findMany({
      where: { nameOnlyHash, msrUid: null },
      select: { id: true },
      take: 2,
    });
    if (candidates.length !== 1) return;

    // updateMany + `msrUid: null` in the WHERE makes a concurrent claim a
    // no-op rather than a crash: the loser matches zero rows.
    await client.driver.updateMany({
      where: { id: candidates[0]!.id, msrUid: null },
      data: { msrUid },
    });
  } catch {
    // Swallowed on purpose — including a unique-constraint collision from a
    // racing login. The user still resolves via nameOnlyHash.
  }
}
