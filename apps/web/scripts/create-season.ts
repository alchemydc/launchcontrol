// Creates a Season row without hand-rolling SQL.
//
// Usage:
//   pnpm --filter web season:create --league <slug> --name <name> --year <n>
//     [--slug <slug>] [--planned <n>] [--minimum-events <n>]
//     [--preset <ruleset name>]
//
// --slug defaults to slugify(name); multiple seasons per (league, year) are
// allowed (see src/lib/create-season.ts), each addressable by its own slug.
// The season points at a ScoringSystem ruleset (a LIVE reference — Task R2):
// --preset names one; without it, the league's oldest ScoringSystem ruleset
// is used (same default `ingestAxdb` applies when auto-creating a Season).
// See src/lib/create-season.ts for the resolution/validation logic this
// script wraps.
import { createSeason } from "@/lib/create-season";
import { prisma } from "@/lib/prisma";

function usage(): never {
  console.error(
    "Usage: pnpm --filter web season:create --league <slug> --name <name> --year <n> " +
      "[--slug <slug>] [--planned <n>] [--minimum-events <n>] [--preset <ruleset name>]",
  );
  process.exit(2);
}

type Args = {
  league?: string;
  name?: string;
  year?: number;
  slug?: string;
  planned?: number;
  minimumEvents?: number;
  preset?: string;
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
      case "--minimum-events":
        args.minimumEvents = Number(next());
        break;
      case "--preset":
        args.preset = next();
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
  if (args.minimumEvents != null && Number.isNaN(args.minimumEvents)) {
    console.error("--minimum-events must be a number.");
    usage();
  }

  const season = await createSeason({
    leagueSlug: args.league,
    name: args.name,
    year: args.year,
    slug: args.slug,
    plannedEvents: args.planned,
    minimumEvents: args.minimumEvents,
    presetName: args.preset,
  });

  console.log(JSON.stringify(season, null, 2));
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
