// Ported from archive (feat/rmsolo-ingest @ 12edd82, apps/web/scripts/ingest-rmsolo.ts),
// adapted with a --league flag (targets ingestRmsoloEvent's { leagueSlug }; defaults to
// DEFAULT_LEAGUE_SLUG, same single-league behavior as before this flag existed).
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { extractPdfText, parseRmsoloFullText } from "@/lib/rmsolo-parse";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { fetchResultsPage, parseResultsPage } from "@/lib/rmsolo-index";

const POLITE_DELAY_MS = 1500;
const UA = "Mozilla/5.0 (compatible; launchcontrol-ingest)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function ingestBuffer(pdf: Buffer, sourceName: string, date: string, name: string | undefined, leagueSlug: string | undefined) {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  // Cheap skip before we bother shelling out to pdftotext / parsing: if a
  // prior run already ingested this exact PDF, do nothing. ingestRmsoloEvent
  // itself provides slug-level idempotency (unchanged vs update) beyond this.
  const existing = await prisma.event.findFirst({ where: { sourceSha256: sha256 } });
  if (existing) {
    console.log(`[skip] ${sourceName} — already ingested (event ${existing.slug})`);
    return null;
  }
  const tmp = join(mkdtempSync(join(tmpdir(), "rmsolo-")), "event.pdf");
  writeFileSync(tmp, pdf);
  const parsed = parseRmsoloFullText(extractPdfText(tmp));
  const result = await ingestRmsoloEvent({ parsed, sha256, date, name, leagueSlug });
  console.log(JSON.stringify(result, null, 2));
  try {
    await writeAudit(prisma, {
      action: "ingest",
      actorMsrUid: "cli",
      actorName: "cli",
      targetType: "event",
      targetId: result.event.id,
      targetSlug: result.event.slug,
      detail: { filename: sourceName, sourceSha256: sha256, status: result.status, counts: result.counts },
    });
  } catch (auditErr) {
    // Audit is best-effort — a logging hiccup must not fail a completed ingest.
    console.error("[ingest:rmsolo] failed to write audit log", auditErr);
  }
  return result;
}

async function main() {
  const leagueSlug = argValue("--league");
  const file = argValue("--file");
  if (file) {
    const date = argValue("--date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error('Usage: pnpm ingest:rmsolo [--league <slug>] --file <pdf> --date YYYY-MM-DD [--name "Event name"]');
      process.exit(2);
    }
    // pnpm sets INIT_CWD to the directory where the user invoked pnpm,
    // so relative paths work the way the user expects (not relative to apps/web).
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
    if (!existsSync(path)) {
      console.error(`File not found: ${path}`);
      process.exit(2);
    }
    await ingestBuffer(readFileSync(path), basename(path), date, argValue("--name"), leagueSlug);
    return;
  }

  console.log("[ingest:rmsolo] fetching results index…");
  const { season, events } = parseResultsPage(await fetchResultsPage());
  console.log(`[ingest:rmsolo] season ${season}: ${events.length} event(s) listed`);
  let failures = 0;
  for (const ev of events) {
    if (!ev.pdfUrls.full) {
      console.warn(`[skip] event #${ev.eventNumber} (${ev.date}) — no Full PDF link`);
      continue;
    }
    // "Pro Solo" events (RMsolo filename convention: starts with "pro", e.g.
    // pro1-0530_full.pdf) use a structurally different results format
    // (reaction-time/60ft columns, a two-run "Total" instead of "Best") that
    // this parser does not support. Deferred like the Winter Series — skip
    // gracefully rather than failing the whole run. A mislabeled file that
    // slips past this filename check still fails loudly via the parser's own
    // Pro Solo detection (see rmsolo-parse.ts), so this is a fast-path
    // optimization, not the only safety net.
    if (/(^|\/)pro/i.test(basename(ev.pdfUrls.full))) {
      console.warn(`[skip] event #${ev.eventNumber} (${ev.date}) — Pro Solo format not yet supported`);
      continue;
    }
    try {
      await sleep(POLITE_DELAY_MS);
      const res = await fetch(ev.pdfUrls.full, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${ev.pdfUrls.full}`);
      await ingestBuffer(Buffer.from(await res.arrayBuffer()), basename(ev.pdfUrls.full), ev.date, undefined, leagueSlug);
    } catch (e) {
      // One bad PDF must not block the season — log loudly, continue (spec: error handling).
      failures += 1;
      console.error(`[FAIL] event #${ev.eventNumber} (${ev.date}):`, e);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
