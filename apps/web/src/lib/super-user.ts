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
  await client.superUser.deleteMany({ where: { msrUid } });
}
