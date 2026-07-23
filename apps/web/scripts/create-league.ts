// Creates a League row (+ a default ScoringSystem preset) without hand-rolling SQL.
//
// Usage:
//   pnpm --filter web league:create --slug <slug> --name <name>
//     [--title <title>] [--description <text>] [--footer <text>] [--landing <text>]
//     [--gate required|optional|none] [--preset-name <name>] [--policy-file <path.json>]
//
// A new league has no ScoringSystem preset — resolveOrCreateSeason's ingest-time
// auto-create path (season-resolve.ts) needs one, so this always creates a default
// preset alongside the League row: --policy-file if given, else a PCA-shaped default
// (fixed drops, no PAX section, raw class metric, 2000ms cone penalty). See
// src/lib/create-league.ts for the resolution/validation logic this script wraps.
import { resolve } from "node:path";
import { createLeague } from "@/lib/create-league";
import { prisma } from "@/lib/prisma";

function usage(): never {
  console.error(
    "Usage: pnpm --filter web league:create --slug <slug> --name <name> " +
      "[--title <title>] [--description <text>] [--footer <text>] [--landing <text>] " +
      "[--gate required|optional|none] [--preset-name <name>] [--policy-file <path.json>]",
  );
  process.exit(2);
}

type Args = {
  slug?: string;
  name?: string;
  title?: string;
  description?: string;
  footer?: string;
  landing?: string;
  gate?: string;
  presetName?: string;
  policyFile?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) usage();
      return v;
    };
    switch (flag) {
      case "--slug":
        args.slug = next();
        break;
      case "--name":
        args.name = next();
        break;
      case "--title":
        args.title = next();
        break;
      case "--description":
        args.description = next();
        break;
      case "--footer":
        args.footer = next();
        break;
      case "--landing":
        args.landing = next();
        break;
      case "--gate":
        args.gate = next();
        break;
      case "--preset-name":
        args.presetName = next();
        break;
      case "--policy-file":
        args.policyFile = next();
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        usage();
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.name) usage();
  if (args.gate && args.gate !== "required" && args.gate !== "optional" && args.gate !== "none") {
    console.error(`--gate must be one of required, optional, none (got '${args.gate}').`);
    process.exit(2);
  }

  // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
  // so relative paths work the way the user expects (not relative to apps/web).
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const policyFilePath = args.policyFile ? resolve(baseDir, args.policyFile) : undefined;

  const result = await createLeague({
    slug: args.slug,
    name: args.name,
    title: args.title,
    description: args.description,
    footer: args.footer,
    landing: args.landing,
    gate: args.gate as "required" | "optional" | "none" | undefined,
    presetName: args.presetName,
    policyFilePath,
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
