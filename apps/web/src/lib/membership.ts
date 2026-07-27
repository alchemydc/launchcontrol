import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const MEMBERSHIP_ROLES = ["ADMIN", "MEMBER", "BLOCKED"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export function parseMembershipRole(v: unknown): MembershipRole {
  if (typeof v === "string" && (MEMBERSHIP_ROLES as readonly string[]).includes(v)) {
    return v as MembershipRole;
  }
  throw new Error(`invalid membership role: ${JSON.stringify(v)}`);
}

export async function setLeagueMembership(
  client: Db,
  { leagueId, msrUid, role }: { leagueId: number; msrUid: string; role: MembershipRole },
): Promise<void> {
  await client.leagueMembership.upsert({
    where: { leagueId_msrUid: { leagueId, msrUid } },
    create: { leagueId, msrUid, role },
    update: { role },
  });
}

export async function removeLeagueMembership(
  client: Db,
  { leagueId, msrUid }: { leagueId: number; msrUid: string },
): Promise<void> {
  await client.leagueMembership.deleteMany({ where: { leagueId, msrUid } });
}

export async function getMembershipRole(
  client: Db,
  leagueId: number,
  msrUid: string,
): Promise<MembershipRole | null> {
  const row = await client.leagueMembership.findUnique({
    where: { leagueId_msrUid: { leagueId, msrUid } },
  });
  return row ? parseMembershipRole(row.role) : null;
}
