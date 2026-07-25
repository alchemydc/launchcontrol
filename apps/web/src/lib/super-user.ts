import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";

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

export async function setSuperUser(
  client: PrismaClient,
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
  // Last-superuser guard (mirrors the league tier's wouldOrphanLastAdmin):
  // with no ADMIN_MSR_UIDS bootstrap configured, deleting the final SuperUser
  // row would permanently lock out every superuser-gated surface (league
  // DELETE, /admin/users, this very route) with no in-app recovery path.
  // Env-allowlisted uids are irrevocable superusers, so any bootstrap entry
  // means revoking the last row is safe.
  const target = await client.superUser.findUnique({ where: { msrUid } });
  if (target == null) return; // nothing to revoke
  if (superUserEnvAllowlist().length === 0) {
    const others = await client.superUser.count({ where: { msrUid: { not: msrUid } } });
    if (others === 0) {
      throw new Error(
        `Cannot revoke ${msrUid}: they are the last superuser and no ADMIN_MSR_UIDS bootstrap is configured`,
      );
    }
  }
  await client.superUser.deleteMany({ where: { msrUid } });
}
