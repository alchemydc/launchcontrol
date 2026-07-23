import type { PrismaClient, ScoringSystem } from "@/generated/prisma/client";
import { parseScoringPolicy } from "@/lib/scoring-policy";

/**
 * League-scoped ScoringSystem preset CRUD (create/update; there is no
 * `deleteScoringSystem` — `deleteLeague` cascades presets, and a preset
 * with no season currently adopting it is otherwise harmless to keep
 * around). Presets are named per league (`@@unique([leagueId, name])`)
 * and their `policy` column is always validated + canonicalized via
 * `parseScoringPolicy` before writing, exactly like `createLeague` and
 * `createSeason` do for their own policy writes.
 *
 * Deliberately does NOT reach into `Season.scoringPolicy` — a Season only
 * ever snapshots a preset's policy at creation/adoption time (see
 * create-season.ts's doc comment), so editing a preset here never changes
 * a season that previously adopted it.
 */

export type CreateScoringSystemOptions = {
  leagueSlug: string;
  name: string;
  policyJson: string;
};

export async function createScoringSystem(
  client: PrismaClient,
  opts: CreateScoringSystemOptions,
): Promise<ScoringSystem> {
  const { leagueSlug, name, policyJson } = opts;

  const league = await client.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) {
    throw new Error(`[scoring-system] unknown league '${leagueSlug}' — check the slug.`);
  }

  const existing = await client.scoringSystem.findFirst({ where: { leagueId: league.id, name } });
  if (existing) {
    throw new Error(
      `[scoring-system] league '${leagueSlug}' already has a scoring system preset named '${name}' (id=${existing.id}).`,
    );
  }

  // Throws a field-level error on invalid JSON or an incomplete/malformed
  // policy shape — never write a ScoringSystem row with a policy scoring
  // code can't parse.
  const policy = parseScoringPolicy(policyJson);

  return client.scoringSystem.create({
    data: { leagueId: league.id, name, policy: JSON.stringify(policy) },
  });
}

export type ScoringSystemRef = { leagueSlug: string; name: string };

export type UpdateScoringSystemPatch = Partial<{
  name: string;
  policyJson: string;
}>;

export async function updateScoringSystem(
  client: PrismaClient,
  ref: ScoringSystemRef,
  patch: UpdateScoringSystemPatch,
): Promise<ScoringSystem> {
  const { leagueSlug, name } = ref;

  const league = await client.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) {
    throw new Error(`[scoring-system] unknown league '${leagueSlug}' — check the slug.`);
  }

  const preset = await client.scoringSystem.findFirst({ where: { leagueId: league.id, name } });
  if (!preset) {
    throw new Error(`[scoring-system] league '${leagueSlug}' has no scoring system preset named '${name}'.`);
  }

  const data: { name?: string; policy?: string } = {};

  if (patch.name !== undefined && patch.name !== preset.name) {
    const dup = await client.scoringSystem.findFirst({ where: { leagueId: league.id, name: patch.name } });
    if (dup) {
      throw new Error(
        `[scoring-system] league '${leagueSlug}' already has a scoring system preset named '${patch.name}' (id=${dup.id}).`,
      );
    }
    data.name = patch.name;
  }

  if (patch.policyJson !== undefined) {
    // Throws a field-level error on invalid JSON or an incomplete/malformed
    // policy shape — never write a ScoringSystem row with a policy scoring
    // code can't parse.
    const policy = parseScoringPolicy(patch.policyJson);
    data.policy = JSON.stringify(policy);
  }

  return client.scoringSystem.update({ where: { id: preset.id }, data });
}
