import { readFileSync } from "node:fs";
import type { League, Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { RMSOLO_PAX_2026 } from "@/lib/rmsolo-pax";
import { DEFAULT_SCORING_POLICY, parseScoringPolicy } from "@/lib/scoring-policy";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type AccessGate = "required" | "optional" | "none";
const ACCESS_GATES: readonly AccessGate[] = ["required", "optional", "none"];

/** Shared by `createLeague` and `updateLeague` — throws if `gate` isn't a recognized AccessGate. */
function validateAccessGate(gate: string): asserts gate is AccessGate {
  if (!ACCESS_GATES.includes(gate as AccessGate)) {
    throw new Error(`[create-league] --gate must be one of ${ACCESS_GATES.join(", ")} (got '${gate}').`);
  }
}

/** Shared by `createLeague` and `updateLeague` — throws unless `logoUrl` is a valid http(s) URL. */
function validateLogoUrl(logoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    throw new Error(`[create-league] --logo-url must be a valid http(s) URL (got '${logoUrl}').`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`[create-league] --logo-url must be a valid http(s) URL (got '${logoUrl}').`);
  }
}

// A new league needs a default ruleset policy when neither --preset-name
// (there IS no preset yet — this call creates the first one) nor
// --policy-file is given. PCA-shaped: fixed drops, no PAX section, 2000ms
// cone penalty — the same defaults `league-foundation` seeded for pca-rmr
// (now canonicalized to v3), a reasonable starting point for any new league.
const DEFAULT_POLICY_JSON =
  JSON.stringify(DEFAULT_SCORING_POLICY);

export type CreateLeagueOptions = {
  slug: string;
  name: string;
  /** Defaults to `Launch Control · <name>`. */
  title?: string;
  /** Defaults to `<name> results, calendar, and community media.` */
  description?: string;
  /** Defaults to null (no footer text — see league-config.ts's platform fallback). */
  footer?: string | null;
  /** Defaults to `Public results and standings for <name>.` */
  landing?: string;
  /** Defaults to "optional". "required" is allowed: per-league membership gating
   *  (decideLeagueAccess) resolves access at request time, so a created league may
   *  carry a "required" gate like the default league. */
  gate?: AccessGate;
  /** Name for the auto-created default ScoringSystem preset. Defaults to `<name> Default`. */
  presetName?: string;
  /** Path to a JSON file holding a ScoringPolicy v3 object for the default preset. Defaults to a PCA-shaped policy. */
  policyFilePath?: string;
  /** Logo image URL for the league gate card grid. Must be http(s) when given. Defaults to null (placeholder tile). */
  logoUrl?: string | null;
};

export type CreateLeagueResult = {
  league: League;
  scoringSystemName: string;
};

/**
 * Creates a League row plus a default ScoringSystem preset — every league
 * needs at least one preset for `resolveOrCreateSeason`'s ingest-time
 * auto-create path to work (see season-resolve.ts), so a bare League row
 * with none would silently break the FIRST ingest into it. Both inserts are
 * wrapped in one transaction: either both land or neither does.
 *
 * Thrown errors are operator-facing (duplicate slug, bad gate, invalid
 * policy) — `scripts/create-league.ts` prints them as-is.
 */
export async function createLeague(
  opts: CreateLeagueOptions,
  client: PrismaClient = defaultClient,
  // Runs inside the same transaction, after the League + preset inserts —
  // the admin route uses this to make the creator's ADMIN membership and
  // the audit row atomic with league creation.
  inTx?: (tx: Prisma.TransactionClient, league: League, scoringSystemName: string) => Promise<void>,
): Promise<CreateLeagueResult> {
  const { slug: rawSlug, name } = opts;

  const slug = rawSlug.trim();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`[create-league] --slug must be lowercase alphanumeric, hyphen-separated (got '${rawSlug}').`);
  }

  const gate = opts.gate ?? "optional";
  validateAccessGate(gate);

  const existing = await client.league.findUnique({ where: { slug } });
  if (existing) {
    throw new Error(`[create-league] a league with slug '${slug}' already exists (id=${existing.id}, name='${existing.name}').`);
  }

  const logoUrl = opts.logoUrl?.trim() || null;
  if (logoUrl) {
    validateLogoUrl(logoUrl);
  }

  let rawPolicy: string;
  if (opts.policyFilePath) {
    try {
      rawPolicy = readFileSync(opts.policyFilePath, "utf8");
    } catch (err) {
      throw new Error(
        `[create-league] failed to read policy file '${opts.policyFilePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    rawPolicy = DEFAULT_POLICY_JSON;
  }
  // Throws a field-level error on invalid JSON or an incomplete/malformed
  // policy shape — never write a ScoringSystem row with a policy scoring
  // code can't parse.
  const policy = parseScoringPolicy(rawPolicy);

  const presetName = opts.presetName?.trim() || `${name} Default`;
  const siteTitle = opts.title?.trim() || `Launch Control · ${name}`;
  const siteDescription = opts.description?.trim() || `${name} results, calendar, and community media.`;
  const landingDescription = opts.landing?.trim() || `Public results and standings for ${name}.`;
  const footerText = opts.footer?.trim() || null;

  const league = await client.$transaction(async (tx) => {
    const created = await tx.league.create({
      data: {
        slug,
        name,
        siteTitle,
        siteDescription,
        footerText,
        landingDescription,
        accessGate: gate,
        logoUrl,
      },
    });
    await tx.scoringSystem.create({
      data: {
        leagueId: created.id,
        name: presetName,
        policy: JSON.stringify(policy),
        // Rulesets carry a COMPLETE paxTable (Task R2 — no built-in fallback
        // at read time), so the default ruleset seeds the full built-in
        // table. Inert for AxWare-sourced leagues, which never read it.
        paxTable: JSON.stringify(RMSOLO_PAX_2026),
      },
    });
    await inTx?.(tx, created, presetName);
    return created;
  });

  return { league, scoringSystemName: presetName };
}

export type UpdateLeaguePatch = Partial<{
  name: string;
  siteTitle: string;
  siteDescription: string;
  footerText: string | null;
  landingDescription: string;
  accessGate: AccessGate;
  msrOrgId: string | null;
  logoUrl: string | null;
  smugmugUser: string | null;
  smugmugDisciplinePath: string | null;
}>;

/**
 * Patches a League row's branding/config fields. Only keys present in
 * `patch` are touched — `undefined` means "leave as-is", `null` (on the
 * nullable fields) means "clear it". Validates `accessGate` and `logoUrl`
 * with the same rules `createLeague` uses (shared helpers above).
 *
 * Superuser-only gating is enforced by the caller (the admin REST route),
 * not here — this function is transport-free.
 */
export async function updateLeague(
  client: PrismaClient | Prisma.TransactionClient,
  slug: string,
  patch: UpdateLeaguePatch,
): Promise<League> {
  const league = await client.league.findUnique({ where: { slug } });
  if (!league) {
    throw new Error(`[update-league] unknown league '${slug}' — check the slug.`);
  }

  if (patch.accessGate !== undefined) {
    validateAccessGate(patch.accessGate);
  }

  let logoUrl: string | null | undefined;
  if (patch.logoUrl !== undefined) {
    logoUrl = patch.logoUrl?.trim() || null;
    if (logoUrl) {
      validateLogoUrl(logoUrl);
    }
  }

  const data: Prisma.LeagueUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.siteTitle !== undefined) data.siteTitle = patch.siteTitle;
  if (patch.siteDescription !== undefined) data.siteDescription = patch.siteDescription;
  if (patch.footerText !== undefined) data.footerText = patch.footerText;
  if (patch.landingDescription !== undefined) data.landingDescription = patch.landingDescription;
  if (patch.accessGate !== undefined) data.accessGate = patch.accessGate;
  if (patch.msrOrgId !== undefined) data.msrOrgId = patch.msrOrgId;
  if (patch.smugmugUser !== undefined) data.smugmugUser = patch.smugmugUser;
  if (patch.smugmugDisciplinePath !== undefined) data.smugmugDisciplinePath = patch.smugmugDisciplinePath;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;

  return client.league.update({ where: { id: league.id }, data });
}

/**
 * Deletes a League row along with its ScoringSystem presets and
 * LeagueMemberships (both `ON DELETE CASCADE` at the DB level). Everything
 * else is deleted explicitly, in order, because their FKs are `ON DELETE
 * RESTRICT` (a league is never dropped out from under events, and a
 * CarClass is never dropped out from under an Entry):
 *   1. CarClass rows scoped to the league (safe once we know there are no
 *      events — see below — since an Entry can only exist under an Event,
 *      so zero events under this league implies zero Entries referencing
 *      any of its CarClass rows, even ones left behind by a prior
 *      deleteEventWithSweep on a now-deleted event).
 *   2. Season rows scoped to the league — BEFORE the League row, which
 *      matters since Task R2: deleting the League cascades its ScoringSystem
 *      rulesets, and `Season.rulesetId` is ON DELETE RESTRICT, so any
 *      surviving Season row would abort that cascade.
 *   3. The League row itself.
 * Refuses (throwing, without deleting anything) if any Event exists under
 * any of the league's seasons — the existence check and the delete happen
 * in one transaction so a concurrent ingest can't sneak an Event in between.
 *
 * Superuser-only gating is enforced by the caller (the admin REST route),
 * not here — this function is transport-free.
 */
export async function deleteLeague(
  client: PrismaClient,
  slug: string,
  // Runs inside the same transaction, after the deletes — used by the admin
  // route to make the audit row atomic with the deletion.
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const league = await tx.league.findUnique({
      where: { slug },
      include: { seasons: { include: { events: { select: { id: true }, take: 1 } } } },
    });
    if (!league) {
      throw new Error(`[delete-league] unknown league '${slug}' — check the slug.`);
    }
    const hasEvents = league.seasons.some((season) => season.events.length > 0);
    if (hasEvents) {
      throw new Error(`[delete-league] league '${slug}' has events — delete its events first.`);
    }

    await tx.carClass.deleteMany({ where: { leagueId: league.id } });
    await tx.season.deleteMany({ where: { leagueId: league.id } });
    await tx.league.delete({ where: { id: league.id } });
    await inTx?.(tx);
  });
}
