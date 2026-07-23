import { readFileSync } from "node:fs";
import type { League, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { parseScoringPolicy } from "@/lib/scoring-policy";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type AccessGate = "required" | "optional" | "none";
const ACCESS_GATES: readonly AccessGate[] = ["required", "optional", "none"];

// A new league needs a default policy to snapshot when neither --preset-name
// (there IS no preset yet — this call creates the first one) nor
// --policy-file is given. PCA-shaped: fixed drops, no PAX section, raw class
// metric, 2000ms cone penalty — the same defaults `league-foundation`
// seeded for pca-rmr, a reasonable starting point for any new league.
const DEFAULT_POLICY_JSON =
  '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';

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
  /** Path to a JSON file holding a ScoringPolicy v1 object for the default preset. Defaults to a PCA-shaped policy. */
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
): Promise<CreateLeagueResult> {
  const { slug: rawSlug, name } = opts;

  const slug = rawSlug.trim();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`[create-league] --slug must be lowercase alphanumeric, hyphen-separated (got '${rawSlug}').`);
  }

  const gate = opts.gate ?? "optional";
  if (!ACCESS_GATES.includes(gate)) {
    throw new Error(`[create-league] --gate must be one of ${ACCESS_GATES.join(", ")} (got '${gate}').`);
  }

  const existing = await client.league.findUnique({ where: { slug } });
  if (existing) {
    throw new Error(`[create-league] a league with slug '${slug}' already exists (id=${existing.id}, name='${existing.name}').`);
  }

  const logoUrl = opts.logoUrl?.trim() || null;
  if (logoUrl) {
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
      },
    });
    return created;
  });

  return { league, scoringSystemName: presetName };
}
