import type { PrismaClient, ScoringSystem } from "@/generated/prisma/client";
import { RMSOLO_PAX_2026, parseSeasonPaxTableStrict } from "@/lib/rmsolo-pax";
import { parseScoringPolicy } from "@/lib/scoring-policy";

/**
 * League-scoped ScoringSystem ruleset CRUD (create/update; there is no
 * `deleteScoringSystem` — `deleteLeague` cascades rulesets after its seasons
 * are gone, and `Season.rulesetId` is ON DELETE RESTRICT so an in-use
 * ruleset can never be dropped out from under a season). Rulesets are named
 * per league (`@@unique([leagueId, name])`); their `policy` column is always
 * validated + canonicalized via `parseScoringPolicy` before writing, exactly
 * like `createLeague` does for its own policy write.
 *
 * Since Task R2 a Season holds a LIVE `rulesetId` reference — editing a
 * ruleset here changes standings for every season that references it, at
 * next render (standings are computed at read time; only the frozen
 * per-entry `Entry.paxIndexApplied` snapshots are untouched — see
 * pax-reapply.ts for the explicit rewrite action).
 *
 * `paxTable` is stored COMPLETE (no built-in fallback at read time): a
 * create without an explicit table seeds the full built-in RMSOLO_PAX_2026
 * table, and any provided table is strict-validated then MERGED over the
 * built-in — mirroring the migration's json_patch(built-in, overrides)
 * semantics, so clients may send just overrides (the pax-table editor's
 * serialization) or a full table with identical results. Extra codes are
 * inert for leagues whose ingest never reads the table (AxWare).
 */

function mergedPaxTableJson(paxTableJson: string | undefined): string {
  const overrides = paxTableJson === undefined ? {} : parseSeasonPaxTableStrict(paxTableJson);
  return JSON.stringify({ ...RMSOLO_PAX_2026, ...overrides });
}

export type CreateScoringSystemOptions = {
  leagueSlug: string;
  name: string;
  policyJson: string;
  /** Optional code->factor JSON; strict-validated and merged over the built-in table. */
  paxTableJson?: string;
};

export async function createScoringSystem(
  client: PrismaClient,
  opts: CreateScoringSystemOptions,
): Promise<ScoringSystem> {
  const { leagueSlug, name, policyJson, paxTableJson } = opts;

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
  // code can't parse. Same contract for the paxTable (strict parser).
  const policy = parseScoringPolicy(policyJson);
  const paxTable = mergedPaxTableJson(paxTableJson);

  return client.scoringSystem.create({
    data: { leagueId: league.id, name, policy: JSON.stringify(policy), paxTable },
  });
}

export type ScoringSystemRef = { leagueSlug: string; name: string };

export type UpdateScoringSystemPatch = Partial<{
  name: string;
  policyJson: string;
  /** Code->factor JSON; strict-validated and merged over the built-in table (send only overrides). */
  paxTableJson: string;
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

  const data: { name?: string; policy?: string; paxTable?: string } = {};

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

  if (patch.paxTableJson !== undefined) {
    data.paxTable = mergedPaxTableJson(patch.paxTableJson);
  }

  return client.scoringSystem.update({ where: { id: preset.id }, data });
}
