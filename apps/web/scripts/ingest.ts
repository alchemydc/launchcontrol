import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ingestAxdb } from "@/lib/ingest";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: pnpm ingest <path-to-axdb>");
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

  const result = await ingestAxdb(path);
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
      detail: { filename: basename(path), axdbSha256: result.axdbSha256, status: result.status, counts: result.counts },
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
