// Ported from archive (feat/rmsolo-ingest @ 12edd82, apps/web/scripts/ingest-rmsolo.ts),
// adapted with a --league flag (targets ingestRmsoloEvent's { leagueSlug }; defaults to
// DEFAULT_LEAGUE_SLUG, same single-league behavior as before this flag existed).
//
// The scrape-loop + per-event ingest orchestration now lives in
// src/lib/rmsolo-run.ts (shared with the capability-gated "Ingest now" admin
// route); this CLI is a thin wrapper: arg parsing + the local `--file` mode.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { ingestBuffer, pdftotextCapability, runRmsoloIngest } from "@/lib/rmsolo-run";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function requirePdftotext(): void {
  const capability = pdftotextCapability();
  if (!capability.enabled) {
    console.error(`[ingest:rmsolo] ${capability.reason ?? "pdftotext is unavailable"}`);
    process.exit(2);
  }
}

async function main() {
  const leagueSlug = argValue("--league");
  // Required when the league has two ACTIVE seasons in one year — season
  // resolution refuses to guess between them (PR #99 review).
  const seasonSlug = argValue("--season");
  const file = argValue("--file");
  if (file) {
    const date = argValue("--date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error('Usage: pnpm ingest:rmsolo [--league <slug>] [--season <slug>] --file <pdf> --date YYYY-MM-DD [--name "Event name"]');
      process.exit(2);
    }
    // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
    // so relative paths work the way the user expects (not relative to apps/web).
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
    if (!existsSync(path)) {
      console.error(`File not found: ${path}`);
      process.exit(2);
    }
    requirePdftotext();
    await ingestBuffer(readFileSync(path), basename(path), date, argValue("--name"), leagueSlug, prisma, {
      seasonSlug,
    });
    return;
  }

  requirePdftotext();
  const counts = await runRmsoloIngest({ leagueSlug, seasonSlug });
  if (counts.failed > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
