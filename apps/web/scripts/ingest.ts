import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ingestAxdb } from "@/lib/ingest";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const leagueSlug = argValue("--league");
  const seasonSlug = argValue("--season");
  // The path is the first argv entry that isn't a flag or a flag's value.
  const FLAGS = ["--league", "--season"];
  const arg = process.argv
    .slice(2)
    .find((a, i, all) => !FLAGS.includes(a) && !FLAGS.includes(all[i - 1] ?? ""));
  if (!arg) {
    console.error("Usage: pnpm ingest [--league <slug>] [--season <slug>] <path-to-axdb>");
    process.exit(2);
  }

  // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
  // so relative paths work the way the user expects (not relative to apps/web).
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const path = resolve(baseDir, arg);
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(2);
  }

  const result = await ingestAxdb(path, prisma, { leagueSlug, seasonSlug });
  console.log(JSON.stringify(result, null, 2));

  try {
    await writeAudit(prisma, {
      action: "ingest",
      actorMsrUid: "cli",
      actorName: "cli",
      targetType: "event",
      targetId: result.event.id,
      targetSlug: result.event.slug,
      // basename only — the absolute path would leak local machine details into the shared DB
      detail: { filename: basename(path), sourceSha256: result.sourceSha256, status: result.status, counts: result.counts },
    });
  } catch (auditErr) {
    // Audit is best-effort — a logging hiccup must not fail a completed ingest.
    console.error("[ingest] failed to write audit log", auditErr);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
