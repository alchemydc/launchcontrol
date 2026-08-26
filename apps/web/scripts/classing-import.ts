// Converts an upstream classing YAML model into the checked-in JSON this app
// reads (src/data/classing/<league>.json).
//
// Usage:
//   pnpm --filter web classing:import --league <slug> <path-to-classing.yml>
//
// Upstream for pca-rmr is enginerdify/rmr-pca-classing (classing.yml), which is
// also the source of the static table published at rmr.pca.org. Re-run this
// after pulling a new upstream revision and commit the JSON diff — the JSON is
// the app's source of truth, the YAML is upstream's.
//
// Touches no database: the classing model is repo data, not tenant config, so
// there is no Prisma client and no audit row here.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseClassingModel, type ClassingModel } from "@/lib/classing";

function usage(): never {
  console.error(
    "Usage: pnpm --filter web classing:import --league <slug> <path-to-classing.yml>",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { league?: string; file?: string } {
  const args: { league?: string; file?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--league") {
      const v = argv[++i];
      if (v === undefined) usage();
      args.league = v;
    } else if (flag !== undefined && flag.startsWith("--")) {
      console.error(`Unknown flag: ${flag}`);
      usage();
    } else if (flag !== undefined) {
      if (args.file !== undefined) usage();
      args.file = flag;
    }
  }
  return args;
}

const warnings: string[] = [];

/** YAML numbers arrive as numbers ("type: 992"); the model is all strings. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Upstream writes a generation half as a YAML float (`version: 0.1`), meaning
 * ".1". Normalize to the display string here so nothing downstream has to know
 * it was ever a number.
 */
function versionText(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  return raw.startsWith("0") ? raw.slice(1) : raw;
}

/**
 * `undefined` means "drop this vehicle"; `null` means "no year range", which is
 * a legitimate upstream shape (the `non-Porsche` -> TO entry: a class defined
 * by what a car isn't has no model years to bound) and renders bare, the way
 * the published table renders it.
 */
function normalizeYears(
  raw: unknown,
  where: string,
): { from: number; to: number | null } | null | undefined {
  if (raw == null) return null;
  if (typeof raw !== "object") {
    warnings.push(`${where}: \`years\` is not a mapping (${JSON.stringify(raw)}) — skipped`);
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const from = Number(obj.from);
  if (!Number.isInteger(from)) {
    warnings.push(`${where}: \`years.from\` is not a year (${JSON.stringify(obj.from)}) — skipped`);
    return undefined;
  }
  if (obj.to == null) return { from, to: null };
  const to = Number(obj.to);
  if (!Number.isInteger(to)) {
    warnings.push(`${where}: \`years.to\` is not a year (${JSON.stringify(obj.to)}) — treated as open-ended`);
    return { from, to: null };
  }
  return { from, to };
}

function normalize(raw: unknown, generatedAt: string): ClassingModel {
  const root = raw as Record<string, unknown> | null;
  const definitions = root?.classingDefinition;
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error("Expected a top-level `classingDefinition` list.");
  }
  if (definitions.length > 1) {
    warnings.push(
      `\`classingDefinition\` has ${definitions.length} entries; only the first is imported`,
    );
  }
  const def = definitions[0] as Record<string, unknown>;
  const rawVehicles = Array.isArray(def.vehicles) ? def.vehicles : [];

  const vehicles = [];
  for (const rawVehicle of rawVehicles) {
    if (rawVehicle == null || typeof rawVehicle !== "object") continue;
    const v = rawVehicle as Record<string, unknown>;
    const type = text(v.type);
    const where = `vehicle \`${type ?? "?"}\``;

    // Upstream has carried placeholder entries that are nothing but a `type:`
    // (the 968 was one until it was filled in). Drop them loudly rather than
    // emitting a vehicle with no model and no classes.
    const model = text(v.model);
    if (type === null || model === null) {
      warnings.push(`${where}: missing \`type\` or \`model\` — skipped`);
      continue;
    }
    const years = normalizeYears(v.years, where);
    if (years === undefined) continue;
    if (!Array.isArray(v.trims) || v.trims.length === 0) {
      warnings.push(`${where}: no \`trims\` — skipped`);
      continue;
    }

    const trims = [];
    for (const rawTrim of v.trims) {
      if (rawTrim == null || typeof rawTrim !== "object") continue;
      const t = rawTrim as Record<string, unknown>;
      // Upstream has at least one entry keyed `trims:` instead of `trim:` (the
      // 944). Accept both rather than silently dropping the vehicle's only trim.
      const name = text(t.trim) ?? text(t.trims);
      if (name === null) {
        warnings.push(`${where}: a trim has no \`trim\` name — skipped`);
        continue;
      }
      if (t.trim == null && t.trims != null) {
        warnings.push(`${where} trim \`${name}\`: read from the \`trims:\` key (upstream typo)`);
      }

      const displacement = t.displacement as Record<string, unknown> | undefined;
      const displacementMax = displacement ? text(displacement.max) : null;

      const classing = [];
      for (const rawEntry of Array.isArray(t.classing) ? t.classing : []) {
        if (rawEntry == null || typeof rawEntry !== "object") continue;
        const c = rawEntry as Record<string, unknown>;
        const classCode = text(c.class);
        const seasons = (Array.isArray(c.seasons) ? c.seasons : [])
          .map((s) => Number(s))
          .filter((s) => Number.isInteger(s));
        if (classCode === null || seasons.length === 0) {
          warnings.push(`${where} trim \`${name}\`: a classing entry has no class or seasons — skipped`);
          continue;
        }
        classing.push({ classCode, seasons: [...new Set(seasons)].sort((a, b) => a - b) });
      }
      if (classing.length === 0) {
        warnings.push(`${where} trim \`${name}\`: no class assignments — skipped`);
        continue;
      }
      trims.push({ trim: name, displacementMax, classing });
    }
    if (trims.length === 0) {
      warnings.push(`${where}: every trim was skipped — vehicle skipped`);
      continue;
    }

    vehicles.push({ type, model, version: versionText(v.version), years, trims });
  }

  // Validate through the same parser the app uses at boot, so a bad import can
  // never produce a file that only fails later, in a page render.
  return parseClassingModel({
    organization: text(def.organization) ?? "Unknown",
    eventType: text(def.eventType) ?? "Autocross",
    generatedAt,
    vehicles,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.league || !args.file) usage();

  const source = readFileSync(resolve(args.file), "utf8");
  const generatedAt = new Date().toISOString().slice(0, 10);
  const model = normalize(parseYaml(source), generatedAt);

  const out = resolve(import.meta.dirname, "..", "src", "data", "classing", `${args.league}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`, "utf8");

  for (const warning of warnings) console.warn(`  warn: ${warning}`);
  const assignments = model.vehicles.reduce(
    (n, v) => n + v.trims.reduce((m, t) => m + t.classing.length, 0),
    0,
  );
  const seasons = new Set(
    model.vehicles.flatMap((v) => v.trims.flatMap((t) => t.classing.flatMap((c) => c.seasons))),
  );
  console.log(
    `Wrote ${out}\n  ${model.vehicles.length} vehicles, ${assignments} class assignments, ` +
      `seasons ${[...seasons].sort((a, b) => a - b).join(", ")}`,
  );
}

try {
  main();
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
