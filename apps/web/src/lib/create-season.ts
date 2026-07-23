import { readFileSync } from "node:fs";
import type { PrismaClient, Season } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";
import { prisma as defaultClient } from "@/lib/prisma";
import { parseScoringPolicy } from "@/lib/scoring-policy";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type CreateSeasonOptions = {
  leagueSlug: string;
  name: string;
  year: number;
  /** Defaults to 0 — matches the ingest auto-create default; edit later once the season's calendar is known. */
  plannedEvents?: number;
  /** URL-safe addressing key, unique per league (see season-resolve.ts's resolveSeasonBySlug).
   *  Defaults to slugify(name). Must already be a valid slug shape (lowercase alphanumeric,
   *  hyphen-separated) — an explicit override is not re-slugified. */
  slug?: string;
  /** Name of an existing ScoringSystem preset on this league. Mutually exclusive with policyFilePath.
   *  If neither is given, the league's OLDEST ScoringSystem row is used (same deterministic
   *  choice `ingestAxdb` makes when auto-creating a Season). */
  presetName?: string;
  /** Path to a JSON file holding a ScoringPolicy v1 object. Mutually exclusive with presetName. */
  policyFilePath?: string;
};

/**
 * Creates a Season row, snapshotting its scoringPolicy from either a named
 * ScoringSystem preset, a policy JSON file, or (default) the league's oldest
 * ScoringSystem preset — never a live reference to the ScoringSystem table
 * (see schema.prisma `Season.scoringPolicy`). The policy is always validated
 * via `parseScoringPolicy` and re-serialized in its canonical shape before
 * writing, so a hand-edited policy file with stray whitespace or key order
 * still lands byte-identical to any other season built from the same values.
 *
 * Thrown errors are operator-facing (unknown league/preset, duplicate season
 * name or slug, invalid policy) — `scripts/create-season.ts` prints them as-is.
 *
 * Multiple seasons per (league, year) are allowed — season-aware addressing
 * (`slug`, resolved via season-resolve.ts's `resolveSeasonBySlug`/`activeSeason`)
 * is what makes them unambiguous to route to, unlocking things like a mid-year
 * Winter Series alongside the regular season.
 */
export async function createSeason(
  opts: CreateSeasonOptions,
  client: PrismaClient = defaultClient,
): Promise<Season> {
  const { leagueSlug, name, year, plannedEvents = 0, presetName, policyFilePath } = opts;

  if (presetName && policyFilePath) {
    throw new Error(
      "[create-season] specify at most one of --preset or --policy-file, not both.",
    );
  }

  const league = await client.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) {
    throw new Error(`[create-season] unknown league '${leagueSlug}' — check the slug.`);
  }

  const existing = await client.season.findFirst({ where: { leagueId: league.id, name } });
  if (existing) {
    throw new Error(
      `[create-season] league '${leagueSlug}' already has a season named '${name}' (id=${existing.id}).`,
    );
  }

  const slug = opts.slug?.trim() || slugify(name);
  if (!slug) {
    throw new Error(
      `[create-season] slugifying '${name}' produced an empty slug — pass --slug explicitly.`,
    );
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `[create-season] --slug must be lowercase alphanumeric, hyphen-separated (got '${slug}').`,
    );
  }
  const existingBySlug = await client.season.findFirst({ where: { leagueId: league.id, slug } });
  if (existingBySlug) {
    throw new Error(
      `[create-season] league '${leagueSlug}' already has a season with slug '${slug}' ` +
        `(name='${existingBySlug.name}', id=${existingBySlug.id}).`,
    );
  }

  let rawPolicy: string;
  if (policyFilePath) {
    try {
      rawPolicy = readFileSync(policyFilePath, "utf8");
    } catch (err) {
      throw new Error(
        `[create-season] failed to read policy file '${policyFilePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    const preset = presetName
      ? await client.scoringSystem.findFirst({ where: { leagueId: league.id, name: presetName } })
      : await client.scoringSystem.findFirst({
          where: { leagueId: league.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
    if (!preset) {
      throw new Error(
        presetName
          ? `[create-season] league '${leagueSlug}' has no scoring system preset named '${presetName}'.`
          : `[create-season] league '${leagueSlug}' has no scoring system presets — create one first.`,
      );
    }
    rawPolicy = preset.policy;
  }

  // Throws a field-level error on invalid JSON or an incomplete/malformed
  // policy shape — never write a Season row with a policy scoring code can't parse.
  const policy = parseScoringPolicy(rawPolicy);

  return client.season.create({
    data: {
      leagueId: league.id,
      name,
      slug,
      year,
      plannedEvents,
      scoringPolicy: JSON.stringify(policy),
    },
  });
}
