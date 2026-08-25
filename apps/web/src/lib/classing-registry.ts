/**
 * Which leagues have a classing model, and where it lives.
 *
 * Split out from `classing.ts` so that module stays free of data imports:
 * `scripts/classing-import.ts` reuses its validation to WRITE the JSON files
 * this module reads, which it could not do if importing the validator also
 * imported a file that may not exist yet.
 *
 * Adding a league is one JSON file plus one line here. A league with no entry
 * gets no classing page (`notFound()`), no subnav tab, and no class tooltips —
 * silently and correctly, since classing rules are league-specific.
 */

import pcaRmr from "@/data/classing/pca-rmr.json";
import {
  classVehicleLines,
  parseClassingModel,
  type ClassingHints,
  type ClassingModel,
} from "@/lib/classing";

// Parsed once at module load: a malformed checked-in file is a build/boot
// failure with a named path, not blank cells at request time.
const CLASSING_MODELS: Record<string, ClassingModel> = {
  "pca-rmr": parseClassingModel(pcaRmr),
};

export function getClassingModel(leagueSlug: string): ClassingModel | null {
  return CLASSING_MODELS[leagueSlug] ?? null;
}

/** Drives the subnav tab and the classing page's notFound(). */
export function hasClassingModel(leagueSlug: string): boolean {
  return leagueSlug in CLASSING_MODELS;
}

/**
 * Class hover-card data for one (league, season), or `undefined` when there is
 * nothing to show — an unclassed league, or a season year the model doesn't
 * cover. `undefined` is what makes `ClassBadge` fall back to its plain,
 * non-interactive rendering, so callers can pass the result straight through.
 */
export function classingHints(
  leagueSlug: string,
  year: number,
  seasonLabel: string,
  basePath = "",
): ClassingHints | undefined {
  const model = getClassingModel(leagueSlug);
  if (!model) return undefined;
  const vehicles = classVehicleLines(model, year);
  if (Object.keys(vehicles).length === 0) return undefined;
  return { vehicles, seasonLabel, basePath };
}

/**
 * Key for the per-row hint lookup the driver history needs: its rows can span
 * leagues AND seasons in one table, so one `ClassingHints` for the whole page
 * would be wrong for most of them.
 */
export function classingKey(leagueSlug: string, year: number): string {
  return `${leagueSlug}|${year}`;
}

/**
 * Build the `classingKey` -> hints map for a mixed set of rows, resolving each
 * distinct (league, season) once. `basePath` is per league because the legacy
 * driver page links default-league rows unprefixed and others into `/l/[slug]`.
 */
export function classingHintsByKey(
  rows: Iterable<{ leagueSlug: string; seasonYear: number }>,
  basePath: (leagueSlug: string) => string,
): Record<string, ClassingHints> {
  const out: Record<string, ClassingHints> = {};
  for (const row of rows) {
    const key = classingKey(row.leagueSlug, row.seasonYear);
    if (key in out) continue;
    const hints = classingHints(
      row.leagueSlug,
      row.seasonYear,
      String(row.seasonYear),
      basePath(row.leagueSlug),
    );
    if (hints) out[key] = hints;
  }
  return out;
}
