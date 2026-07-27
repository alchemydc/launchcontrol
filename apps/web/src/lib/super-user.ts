import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** Comma-separated ADMIN_MSR_UIDS — the irrevocable superuser bootstrap. */
export function superUserEnvAllowlist(): string[] {
  return (process.env.ADMIN_MSR_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function isSuperUser(
  msrUid: string | null | undefined,
  client: PrismaClient = defaultClient,
): Promise<boolean> {
  if (!msrUid) return false;
  if (superUserEnvAllowlist().includes(msrUid)) return true;
  const row = await client.superUser.findUnique({ where: { msrUid } });
  return row !== null;
}

// Last-superuser guard (mirrors the league tier's wouldOrphanLastAdmin):
// with no ADMIN_MSR_UIDS bootstrap configured, deleting the final SuperUser
// row would permanently lock out every superuser-gated surface (league
// DELETE, /admin/users, the superusers route) with no in-app recovery path.
// Env-allowlisted uids are irrevocable superusers, so any bootstrap entry
// means revoking the last row is safe.
async function revokeSuperUser(db: Db, msrUid: string): Promise<void> {
  const target = await db.superUser.findUnique({ where: { msrUid } });
  if (target == null) return; // nothing to revoke
  if (superUserEnvAllowlist().length === 0) {
    const others = await db.superUser.count({ where: { msrUid: { not: msrUid } } });
    if (others === 0) {
      throw new Error(
        `Cannot revoke ${msrUid}: they are the last superuser and no ADMIN_MSR_UIDS bootstrap is configured`,
      );
    }
  }
  await db.superUser.deleteMany({ where: { msrUid } });
}

export async function setSuperUser(
  client: Db,
  msrUid: string,
  granted: boolean,
): Promise<void> {
  if (granted) {
    await client.superUser.upsert({ where: { msrUid }, create: { msrUid }, update: {} });
    return;
  }
  if (superUserEnvAllowlist().includes(msrUid)) {
    throw new Error(`Cannot revoke ${msrUid}: listed in ADMIN_MSR_UIDS env bootstrap`);
  }
  // The others-count and the delete must share a transaction: two concurrent
  // cross-revocations could otherwise each observe the other as a survivor
  // and both delete, leaving zero superusers. Callers already inside a
  // transaction (no $transaction on the handle) get atomicity from theirs.
  if ("$transaction" in client) {
    await client.$transaction((tx) => revokeSuperUser(tx, msrUid));
  } else {
    await revokeSuperUser(client, msrUid);
  }
}
