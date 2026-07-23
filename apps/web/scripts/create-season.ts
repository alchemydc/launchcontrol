// Creates a Season row without hand-rolling SQL.
//
// Usage:
//   pnpm --filter web season:create --league <slug> --name <name> --year <n>
//     [--slug <slug>] [--planned <n>] [--preset <scoring-system name>] [--policy-file <path.json>]
//
// --slug defaults to slugify(name); multiple seasons per (league, year) are
// allowed (see src/lib/create-season.ts), each addressable by its own slug.
// At most one of --preset / --policy-file may be given; with neither, the
// league's oldest ScoringSystem preset is used (same default `ingestAxdb`
// applies when auto-creating a Season). See src/lib/create-season.ts for the
// resolution/validation logic this script wraps.
import { resolve } from "node:path";
import { createSeason } from "@/lib/create-season";
import { prisma } from "@/lib/prisma";

function usage(): never {
  console.error(
    "Usage: pnpm --filter web season:create --league <slug> --name <name> --year <n> " +
      "[--slug <slug>] [--planned <n>] [--preset <scoring-system name>] [--policy-file <path.json>]",
  );
  process.exit(2);
}

type Args = {
  league?: string;
  name?: string;
  year?: number;
  slug?: string;
  planned?: number;
  preset?: string;
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
      case "--league":
        args.league = next();
        break;
      case "--name":
        args.name = next();
        break;
      case "--year":
        args.year = Number(next());
        break;
      case "--slug":
        args.slug = next();
        break;
      case "--planned":
        args.planned = Number(next());
        break;
      case "--preset":
        args.preset = next();
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
  if (!args.league || !args.name || args.year == null || Number.isNaN(args.year)) usage();
  if (args.planned != null && Number.isNaN(args.planned)) {
    console.error("--planned must be a number.");
    usage();
  }
  if (args.preset && args.policyFile) {
    console.error("Specify at most one of --preset or --policy-file, not both.");
    process.exit(2);
  }

  // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
  // so relative paths work the way the user expects (not relative to apps/web).
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const policyFilePath = args.policyFile ? resolve(baseDir, args.policyFile) : undefined;

  const season = await createSeason({
    leagueSlug: args.league,
    name: args.name,
    year: args.year,
    slug: args.slug,
    plannedEvents: args.planned,
    presetName: args.preset,
    policyFilePath,
  });

  console.log(JSON.stringify(season, null, 2));
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
