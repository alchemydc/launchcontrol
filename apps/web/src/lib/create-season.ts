import type { Prisma, PrismaClient, Season } from "@/generated/prisma/client";
import { slugify } from "@/lib/ingest";
import { prisma as defaultClient } from "@/lib/prisma";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SeasonStatus = "active" | "completed";
const SEASON_STATUSES: readonly SeasonStatus[] = ["active", "completed"];

export type CreateSeasonOptions = {
  leagueSlug: string;
  name: string;
  year: number;
  /** Defaults to 0 — matches the ingest auto-create default; edit later once the season's calendar is known. */
  plannedEvents?: number;
  /** Attendance required for an official standing. Defaults to 4. */
  minimumEvents?: number;
  /** URL-safe addressing key, unique per league (see season-resolve.ts's resolveSeasonBySlug).
   *  Defaults to slugify(name). Must already be a valid slug shape (lowercase alphanumeric,
   *  hyphen-separated) — an explicit override is not re-slugified. */
  slug?: string;
  /** Name of an existing ScoringSystem ruleset on this league (kept as `presetName` to avoid
   *  CLI churn). If not given, the league's OLDEST ScoringSystem row is used (same deterministic
   *  choice `ingestAxdb` makes when auto-creating a Season). */
  presetName?: string;
  /** REMOVED (Task R2): policies live on rulesets now. Any non-undefined value throws. */
  policyFilePath?: string;
};

/**
 * Creates a Season row pointing at a ScoringSystem ruleset — a LIVE
 * reference (`Season.rulesetId`), not a snapshot: since Task R2 the Season
 * row stores no policy or paxTable of its own, and standings read the
 * ruleset's current values at render time. The ruleset is either the named
 * one (`presetName`) or (default) the league's oldest ScoringSystem row.
 *
 * Thrown errors are operator-facing (unknown league/ruleset, duplicate
 * season name or slug) — `scripts/create-season.ts` prints them as-is.
 *
 * Multiple seasons per (league, year) are allowed — season-aware addressing
 * (`slug`, resolved via season-resolve.ts's `resolveSeasonBySlug`/`activeSeason`)
 * is what makes them unambiguous to route to, unlocking things like a mid-year
 * Winter Series alongside the regular season.
 */
export async function createSeason(
  opts: CreateSeasonOptions,
  client: PrismaClient | Prisma.TransactionClient = defaultClient,
): Promise<Season> {
  const {
    leagueSlug,
    name,
    year,
    plannedEvents = 0,
    minimumEvents = 4,
    presetName,
    policyFilePath,
  } = opts;

  if (policyFilePath !== undefined) {
    throw new Error(
      "[create-season] --policy-file is gone: scoring policies live on rulesets now. " +
        "Create or edit a ruleset (scoring system) and pass its name via --preset instead.",
    );
  }
  if (!Number.isInteger(plannedEvents) || plannedEvents < 0) {
    throw new Error(
      `[create-season] plannedEvents must be a non-negative integer (got ${JSON.stringify(plannedEvents)}).`,
    );
  }
  if (!Number.isInteger(minimumEvents) || minimumEvents < 0) {
    throw new Error(
      `[create-season] minimumEvents must be a non-negative integer (got ${JSON.stringify(minimumEvents)}).`,
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

  return client.season.create({
    data: {
      leagueId: league.id,
      name,
      slug,
      year,
      plannedEvents,
      minimumEvents,
      rulesetId: preset.id,
    },
  });
}

export type SeasonRef = { leagueSlug: string; seasonSlug: string };

export type UpdateSeasonPatch = Partial<{
  name: string;
  slug: string;
  year: number;
  plannedEvents: number;
  minimumEvents: number;
  status: SeasonStatus;
  /** Id of a ScoringSystem ruleset belonging to the SAME league — validated before writing. */
  rulesetId: number;
}>;

/**
 * Patches a Season row's editable fields. Only keys present in `patch` are
 * touched. `slug`, if given, must already be valid slug shape (same rule
 * `createSeason` uses — NOT re-slugified) and, like `name`, is checked for
 * a duplicate within the league before writing.
 *
 * Scoring is edited by re-pointing `rulesetId` at a different ruleset of the
 * same league (Task R2) — per-season policy/paxTable snapshots are gone.
 * Standings recompute at read time through the live ruleset reference, so
 * re-pointing a season (including a past season) changes its standings
 * immediately; editing the ruleset itself (`scoring-system.ts`) likewise
 * flows through to every season referencing it.
 */
export async function updateSeason(
  client: PrismaClient | Prisma.TransactionClient,
  ref: SeasonRef,
  patch: UpdateSeasonPatch,
): Promise<Season> {
  const { leagueSlug, seasonSlug } = ref;

  const league = await client.league.findUnique({ where: { slug: leagueSlug } });
  if (!league) {
    throw new Error(`[update-season] unknown league '${leagueSlug}' — check the slug.`);
  }

  const season = await client.season.findFirst({ where: { leagueId: league.id, slug: seasonSlug } });
  if (!season) {
    throw new Error(`[update-season] league '${leagueSlug}' has no season with slug '${seasonSlug}'.`);
  }

  if (patch.status !== undefined && !SEASON_STATUSES.includes(patch.status)) {
    throw new Error(`[update-season] status must be one of ${SEASON_STATUSES.join(", ")} (got '${patch.status}').`);
  }
  if (
    patch.plannedEvents !== undefined &&
    (!Number.isInteger(patch.plannedEvents) || patch.plannedEvents < 0)
  ) {
    throw new Error(
      `[update-season] plannedEvents must be a non-negative integer (got ${JSON.stringify(patch.plannedEvents)}).`,
    );
  }
  if (
    patch.minimumEvents !== undefined &&
    (!Number.isInteger(patch.minimumEvents) || patch.minimumEvents < 0)
  ) {
    throw new Error(
      `[update-season] minimumEvents must be a non-negative integer (got ${JSON.stringify(patch.minimumEvents)}).`,
    );
  }

  if (patch.name !== undefined && patch.name !== season.name) {
    const dup = await client.season.findFirst({ where: { leagueId: league.id, name: patch.name } });
    if (dup) {
      throw new Error(
        `[update-season] league '${leagueSlug}' already has a season named '${patch.name}' (id=${dup.id}).`,
      );
    }
  }

  let newSlug: string | undefined;
  if (patch.slug !== undefined && patch.slug !== season.slug) {
    const slug = patch.slug.trim();
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(
        `[update-season] --slug must be lowercase alphanumeric, hyphen-separated (got '${patch.slug}').`,
      );
    }
    const dupSlug = await client.season.findFirst({ where: { leagueId: league.id, slug } });
    if (dupSlug) {
      throw new Error(
        `[update-season] league '${leagueSlug}' already has a season with slug '${slug}' ` +
          `(name='${dupSlug.name}', id=${dupSlug.id}).`,
      );
    }
    newSlug = slug;
  }

  if (patch.rulesetId !== undefined) {
    if (typeof patch.rulesetId !== "number" || !Number.isInteger(patch.rulesetId)) {
      throw new Error(`[update-season] rulesetId must be an integer (got ${JSON.stringify(patch.rulesetId)}).`);
    }
    const ruleset = await client.scoringSystem.findUnique({ where: { id: patch.rulesetId } });
    if (!ruleset || ruleset.leagueId !== league.id) {
      throw new Error(
        `[update-season] league '${leagueSlug}' has no ruleset with id ${patch.rulesetId} — ` +
          `a season can only adopt a ruleset of its own league.`,
      );
    }
  }

  const data: Prisma.SeasonUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (newSlug !== undefined) data.slug = newSlug;
  if (patch.year !== undefined) data.year = patch.year;
  if (patch.plannedEvents !== undefined) data.plannedEvents = patch.plannedEvents;
  if (patch.minimumEvents !== undefined) data.minimumEvents = patch.minimumEvents;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.rulesetId !== undefined) data.ruleset = { connect: { id: patch.rulesetId } };

  return client.season.update({ where: { id: season.id }, data });
}
