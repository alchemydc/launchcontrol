import type { MembershipRole } from "@/lib/membership";

export type LeagueAccessDecision = "allow" | "deny" | "redirect";

/**
 * Pure gate decision for one league. Order is load-bearing (spec §Access decision):
 * superuser > BLOCKED > explicit membership > public gate > MSR org match > redirect.
 * Callers that skip session reads for public gates never reach this with a role,
 * so BLOCKED effectively applies to gated access only.
 */
export function decideLeagueAccess(input: {
  accessGate: string;
  msrOrgId: string | null;
  membershipRole: MembershipRole | null;
  superUser: boolean;
  session: { msrUid?: string; msrOrgIds?: string[] };
}): LeagueAccessDecision {
  if (input.superUser) return "allow";
  if (input.membershipRole === "BLOCKED") return "deny";
  if (input.membershipRole === "ADMIN" || input.membershipRole === "MEMBER") return "allow";
  if (input.accessGate !== "required") return "allow";
  if (input.msrOrgId && input.session.msrOrgIds?.includes(input.msrOrgId)) return "allow";
  return "redirect";
}
