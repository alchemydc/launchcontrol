/**
 * Vehicle classing — which car runs in which class, per league, per season.
 *
 * Classing rules are league-specific (PCA's C1..C5/CS has nothing to do with
 * SCCA's SS/AS/BS...), so every model here is keyed by league slug and a league
 * with no model simply has no classing page and no class tooltips.
 *
 * The model is CHECKED-IN JSON, not DB data — unlike League/Season/ScoringSystem,
 * which are per-deployment tenant config. A classing table is a published rulebook
 * that changes about once a season and wants PR review, and it is read on every
 * page that renders a class badge, where a DB read would cost a Turso round trip
 * per render for data that never varies between deployments. `scripts/classing-import.ts`
 * converts the upstream YAML (enginerdify/rmr-pca-classing) into `src/data/classing/`.
 *
 * This module is PURE — shape, validation, grouping, lookup, and nothing else.
 * The JSON files themselves are loaded by `classing-registry.ts`, which is a
 * separate module only so `scripts/classing-import.ts` can reuse this validation
 * to GENERATE those files without importing one that may not exist yet.
 */

// ---------------------------------------------------------------------------
// Model shape
// ---------------------------------------------------------------------------

/** `to: null` means open-ended ("2020+") — the model has no end year yet. */
export type ClassingYears = { from: number; to: number | null };

/** One class assignment, valid only in the listed season years. */
export type ClassingAssignment = { classCode: string; seasons: number[] };

export type ClassingTrim = {
  /** Trim name, or "all" when the model has no trim split. */
  trim: string;
  /**
   * Engine-size qualifier on this trim ("3.3L"), e.g. the G-Series 911 Turbo is
   * only C1 up to 3.3L. Carried through grouping and rendered as a condition on
   * the trim — the upstream generator drops it, so its published table silently
   * over-claims the class.
   */
  displacementMax: string | null;
  classing: ClassingAssignment[];
};

export type ClassingVehicle = {
  /** Generation / body code — "992", "G-Series", "Cayenne". May equal `model`. */
  type: string;
  /** Marketing model — "911", "Boxster/Cayman", "718 Boxster/Cayman". */
  model: string;
  /** Generation half-split, already display-formatted: ".1" / ".2". */
  version: string | null;
  years: ClassingYears;
  trims: ClassingTrim[];
};

export type ClassingModel = {
  organization: string;
  eventType: string;
  /** ISO date the JSON was generated from upstream YAML, for the page footer. */
  generatedAt: string;
  vehicles: ClassingVehicle[];
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fail(path: string, expected: string, raw: unknown): never {
  throw new Error(`classing.${path} must be ${expected} — got ${JSON.stringify(raw)}`);
}

function asObject(raw: unknown, path: string): Record<string, unknown> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(path, "a JSON object", raw);
  }
  return raw as Record<string, unknown>;
}

function asNonEmptyString(raw: unknown, path: string): string {
  if (typeof raw !== "string" || raw.trim() === "") fail(path, "a non-empty string", raw);
  return raw;
}

function asYear(raw: unknown, path: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1900 || raw > 2200) {
    fail(path, "a 4-digit year", raw);
  }
  return raw;
}

function parseYears(raw: unknown, path: string): ClassingYears {
  const obj = asObject(raw, path);
  const from = asYear(obj.from, `${path}.from`);
  if (obj.to === null || obj.to === undefined) return { from, to: null };
  const to = asYear(obj.to, `${path}.to`);
  if (to < from) fail(`${path}.to`, `>= ${path}.from (${from})`, to);
  return { from, to };
}

function parseAssignment(raw: unknown, path: string): ClassingAssignment {
  const obj = asObject(raw, path);
  const classCode = asNonEmptyString(obj.classCode, `${path}.classCode`);
  if (!Array.isArray(obj.seasons) || obj.seasons.length === 0) {
    fail(`${path}.seasons`, "a non-empty array of years", obj.seasons);
  }
  const seasons = obj.seasons.map((s, i) => asYear(s, `${path}.seasons[${i}]`));
  return { classCode, seasons: [...seasons].sort((a, b) => a - b) };
}

function parseTrim(raw: unknown, path: string): ClassingTrim {
  const obj = asObject(raw, path);
  const trim = asNonEmptyString(obj.trim, `${path}.trim`);
  const displacementMax =
    obj.displacementMax == null
      ? null
      : asNonEmptyString(obj.displacementMax, `${path}.displacementMax`);
  if (!Array.isArray(obj.classing) || obj.classing.length === 0) {
    fail(`${path}.classing`, "a non-empty array", obj.classing);
  }
  return {
    trim,
    displacementMax,
    classing: obj.classing.map((c, i) => parseAssignment(c, `${path}.classing[${i}]`)),
  };
}

function parseVehicle(raw: unknown, path: string): ClassingVehicle {
  const obj = asObject(raw, path);
  if (!Array.isArray(obj.trims) || obj.trims.length === 0) {
    fail(`${path}.trims`, "a non-empty array", obj.trims);
  }
  return {
    type: asNonEmptyString(obj.type, `${path}.type`),
    model: asNonEmptyString(obj.model, `${path}.model`),
    version: obj.version == null ? null : asNonEmptyString(obj.version, `${path}.version`),
    years: parseYears(obj.years, `${path}.years`),
    trims: obj.trims.map((t, i) => parseTrim(t, `${path}.trims[${i}]`)),
  };
}

/**
 * Strictly validate a classing model, naming the offending path. Shared by the
 * importer (so a bad upstream edit fails at import) and by the loader below (so
 * a hand-edited JSON file fails at boot rather than rendering blank cells).
 */
export function parseClassingModel(raw: unknown): ClassingModel {
  const obj = asObject(raw, "");
  if (!Array.isArray(obj.vehicles) || obj.vehicles.length === 0) {
    fail("vehicles", "a non-empty array", obj.vehicles);
  }
  return {
    organization: asNonEmptyString(obj.organization, "organization"),
    eventType: asNonEmptyString(obj.eventType, "eventType"),
    generatedAt: asNonEmptyString(obj.generatedAt, "generatedAt"),
    vehicles: obj.vehicles.map((v, i) => parseVehicle(v, `vehicles[${i}]`)),
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** One trim within a rendered vehicle line, with its own engine-size condition. */
export type VehicleLineTrim = { name: string; displacementMax: string | null };

/** A single "• 992 911 · S, GTS, Turbo · 2020+" row, in parts rather than markup. */
export type VehicleLine = {
  /** "992.1 911", "Cayenne", "982 718 Boxster/Cayman". */
  title: string;
  /** Empty when the vehicle has no trim split (upstream `trim: all`). */
  trims: VehicleLineTrim[];
  /** "1983-1991" | "2020+" | "all years". */
  years: string;
};

export type ClassSection = { classCode: string; vehicles: VehicleLine[] };

/**
 * Display order for trims: roughly ascending performance, matching the upstream
 * generator so our table reads the same as the published one. Anything unknown
 * sorts last, alphabetically.
 */
const TRIM_ORDER = ["base", "S", "GTS", "Turbo", "Turbo S", "R"];

function trimSortKey(trim: string): [number, string] {
  const i = TRIM_ORDER.indexOf(trim);
  return [i === -1 ? TRIM_ORDER.length : i, trim];
}

function compareTrims(a: VehicleLineTrim, b: VehicleLineTrim): number {
  const [ai, an] = trimSortKey(a.name);
  const [bi, bn] = trimSortKey(b.name);
  return ai - bi || an.localeCompare(bn);
}

function formatYears(years: ClassingYears): string {
  if (years.to == null) return `${years.from}+`;
  return `${years.from}-${years.to}`;
}

/**
 * Merge year ranges across collapsed generation halves. An open-ended range
 * wins: if any merged source lacks an end year, the result is open-ended too,
 * otherwise "996.1 (1999-2001) + 996.2 (2002-2004)" would read as a closed
 * range that happens to be right only by luck.
 */
function mergeYears(a: ClassingYears, b: ClassingYears): ClassingYears {
  return {
    from: Math.min(a.from, b.from),
    to: a.to == null || b.to == null ? null : Math.max(a.to, b.to),
  };
}

function vehicleTitle(vehicle: { type: string; model: string; version: string | null }): string {
  const typeWithVersion = `${vehicle.type}${vehicle.version ?? ""}`;
  return typeWithVersion === vehicle.model
    ? vehicle.model
    : `${typeWithVersion} ${vehicle.model}`;
}

/** The rendered form of one vehicle + the trims of it that landed in this class. */
export function formatVehicleLabel(
  vehicle: { type: string; model: string; version: string | null; years: ClassingYears },
  trims: VehicleLineTrim[],
): VehicleLine {
  return {
    title: vehicleTitle(vehicle),
    trims: [...trims].sort(compareTrims),
    years: formatYears(vehicle.years),
  };
}

type Bucket = {
  type: string;
  model: string;
  version: string | null;
  years: ClassingYears;
  trims: VehicleLineTrim[];
};

/** Stable identity for "same trims listed, in the same order, with the same conditions". */
function trimSignature(trims: VehicleLineTrim[]): string {
  return [...trims]
    .sort(compareTrims)
    .map((t) => `${t.name} ${t.displacementMax ?? ""}`)
    .join("");
}

/**
 * Every class for one season, with its vehicles collapsed for display.
 *
 * Two collapses, in order, mirroring the upstream generator:
 *   1. Per (type, model, version): union the trims that landed in this class, so
 *      the four separate `992 911` trim entries read as one line.
 *   2. Per (type, model) family: collapse generation halves that ended up with an
 *      IDENTICAL trim list, merging their year ranges — so `996.1`/`996.2` become
 *      one "996 911 ... 1999-2004" line, while `987.1` (S) and `987.2` (S, R) stay
 *      separate because their trims differ and merging would misstate them.
 *
 * Vehicles keep upstream file order (which is generation order); classes sort by code.
 */
export function classingForSeason(model: ClassingModel, year: number): ClassSection[] {
  // classCode -> bucketKey -> bucket, both insertion-ordered.
  const byClass = new Map<string, Map<string, Bucket>>();

  for (const vehicle of model.vehicles) {
    for (const trim of vehicle.trims) {
      for (const assignment of trim.classing) {
        if (!assignment.seasons.includes(year)) continue;

        let buckets = byClass.get(assignment.classCode);
        if (!buckets) {
          buckets = new Map();
          byClass.set(assignment.classCode, buckets);
        }

        const key = `${vehicle.type} ${vehicle.model} ${vehicle.version ?? ""}`;
        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, {
            type: vehicle.type,
            model: vehicle.model,
            version: vehicle.version,
            years: vehicle.years,
            // "all" is the absence of a trim split, not a trim named "all".
            trims: trim.trim === "all" ? [] : [{ name: trim.trim, displacementMax: trim.displacementMax }],
          });
          continue;
        }
        existing.years = mergeYears(existing.years, vehicle.years);
        if (trim.trim !== "all" && !existing.trims.some((t) => t.name === trim.trim)) {
          existing.trims.push({ name: trim.trim, displacementMax: trim.displacementMax });
        }
      }
    }
  }

  const sections: ClassSection[] = [];
  for (const [classCode, buckets] of byClass) {
    // family key -> trim signature -> merged bucket
    const families = new Map<string, Map<string, Bucket>>();
    for (const bucket of buckets.values()) {
      const familyKey = `${bucket.type} ${bucket.model}`;
      let bySignature = families.get(familyKey);
      if (!bySignature) {
        bySignature = new Map();
        families.set(familyKey, bySignature);
      }
      const signature = trimSignature(bucket.trims);
      const existing = bySignature.get(signature);
      if (!existing) {
        bySignature.set(signature, bucket);
        continue;
      }
      // Second and later generation half with the same trims: fold it in and
      // drop the version, since the line now covers more than one of them.
      existing.years = mergeYears(existing.years, bucket.years);
      existing.version = null;
    }

    const vehicles: VehicleLine[] = [];
    for (const bySignature of families.values()) {
      for (const bucket of bySignature.values()) {
        vehicles.push(formatVehicleLabel(bucket, bucket.trims));
      }
    }
    sections.push({ classCode, vehicles });
  }

  return sections.sort((a, b) => a.classCode.localeCompare(b.classCode));
}

/** One rendered vehicle line as a single string, for tooltips and compact lists. */
export function vehicleLineText(line: VehicleLine): string {
  const parts = [line.title];
  if (line.trims.length > 0) {
    parts.push(
      line.trims
        .map((t) => (t.displacementMax ? `${t.name} (max ${t.displacementMax})` : t.name))
        .join(", "),
    );
  }
  parts.push(line.years);
  return parts.join(" · ");
}

/**
 * Everything a results table needs to render class hover cards, resolved once
 * per page render on the server and threaded down as a single prop.
 */
export type ClassingHints = {
  /** Class code -> pre-formatted vehicle lines. */
  vehicles: Record<string, string[]>;
  /** The season those lines describe — "2026 Season", or a bare year. */
  seasonLabel: string;
  /** "" for the legacy routes, "/l/[slug]" for league-scoped. */
  basePath: string;
};

/**
 * The compact form the class tooltips consume: class code -> pre-formatted lines.
 * Built on `classingForSeason` so a tooltip can never disagree with the table.
 * Computed once per page render and passed into the client tables as a prop —
 * there is no per-row work and no client fetch.
 */
export function classVehicleLines(
  model: ClassingModel,
  year: number,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const section of classingForSeason(model, year)) {
    out[section.classCode] = section.vehicles.map(vehicleLineText);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lookup ("find my class")
// ---------------------------------------------------------------------------

export type LookupMatch = {
  classCode: string;
  vehicle: VehicleLine;
  /** Set when the matched trim is only in this class up to a given engine size. */
  displacementMax: string | null;
};

function coversYear(years: ClassingYears, year: number): boolean {
  return year >= years.from && (years.to == null || year <= years.to);
}

/** Every model name with at least one class assignment in this season, sorted. */
export function lookupModels(model: ClassingModel, season: number): string[] {
  const names = new Set<string>();
  for (const vehicle of model.vehicles) {
    if (vehicle.trims.some((t) => t.classing.some((c) => c.seasons.includes(season)))) {
      names.add(vehicle.model);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Model years offered by the picker, newest first. An open-ended vehicle is
 * capped at `maxYear` (the caller passes the season year, so a 2026 season
 * offers a 2026 992 without inventing years beyond the season being viewed).
 */
export function lookupYears(
  model: ClassingModel,
  season: number,
  modelName: string,
  maxYear: number,
): number[] {
  const years = new Set<number>();
  for (const vehicle of model.vehicles) {
    if (vehicle.model !== modelName) continue;
    if (!vehicle.trims.some((t) => t.classing.some((c) => c.seasons.includes(season)))) continue;
    const to = Math.max(vehicle.years.to ?? maxYear, vehicle.years.from);
    for (let y = vehicle.years.from; y <= to; y += 1) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * Trim names offered for a (model, year), sorted in display order. "all" is
 * preserved as an explicit option so the picker can say "this model has no trim
 * split" rather than silently offering nothing.
 */
export function lookupTrims(
  model: ClassingModel,
  season: number,
  modelName: string,
  year: number,
): string[] {
  const names = new Set<string>();
  for (const vehicle of model.vehicles) {
    if (vehicle.model !== modelName || !coversYear(vehicle.years, year)) continue;
    for (const trim of vehicle.trims) {
      if (trim.classing.some((c) => c.seasons.includes(season))) names.add(trim.trim);
    }
  }
  return [...names].sort((a, b) => {
    const [ai, an] = trimSortKey(a);
    const [bi, bn] = trimSortKey(b);
    return ai - bi || an.localeCompare(bn);
  });
}

/**
 * Resolve a (model, year, trim) to its class(es) for one season.
 *
 * Returns EVERY match rather than the first: the model can legitimately place
 * one description in more than one class (overlapping generation year ranges),
 * and showing both is honest where picking one silently would not be.
 */
export function lookupClass(
  model: ClassingModel,
  query: { modelName: string; year: number; trim: string; season: number },
): LookupMatch[] {
  const matches: LookupMatch[] = [];
  for (const vehicle of model.vehicles) {
    if (vehicle.model !== query.modelName || !coversYear(vehicle.years, query.year)) continue;
    for (const trim of vehicle.trims) {
      if (trim.trim !== query.trim) continue;
      for (const assignment of trim.classing) {
        if (!assignment.seasons.includes(query.season)) continue;
        matches.push({
          classCode: assignment.classCode,
          vehicle: formatVehicleLabel(
            vehicle,
            trim.trim === "all" ? [] : [{ name: trim.trim, displacementMax: trim.displacementMax }],
          ),
          displacementMax: trim.displacementMax,
        });
      }
    }
  }
  return matches;
}
