import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export type AuditAction =
  | "ingest"
  | "ingest.now"
  | "event.update"
  | "event.delete"
  | "league.create"
  | "league.update"
  | "league.delete"
  | "season.create"
  | "season.update"
  | "preset.create"
  | "preset.update"
  | "membership.update"
  | "superuser.update";

export type AuditTargetType = "event" | "league" | "season" | "scoringSystem" | "membership" | "superUser";

export type AuditEntry = {
  action: AuditAction;
  actorMsrUid: string;
  actorName: string;
  targetType: AuditTargetType;
  targetId?: number;
  targetSlug?: string;
  detail: unknown;
};

/**
 * Writes one AdminAuditLog row. Callers that treat auditing as best-effort
 * (i.e. must not fail the primary operation on an audit hiccup) should wrap
 * this call in their own try/catch — this function does not swallow errors.
 */
export async function writeAudit(
  client: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await client.adminAuditLog.create({
    data: {
      action: entry.action,
      actorMsrUid: entry.actorMsrUid,
      actorName: entry.actorName,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetSlug: entry.targetSlug ?? null,
      detail: JSON.stringify(entry.detail),
    },
  });
}
