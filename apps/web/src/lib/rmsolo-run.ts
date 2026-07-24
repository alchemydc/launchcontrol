// Shared RMsolo scrape-loop orchestration, extracted from
// scripts/ingest-rmsolo.ts so the CLI and the capability-gated "Ingest now"
// admin route run the EXACT same loop: index fetch → per-event Full-PDF
// download (1.5s polite delay) → sha256 pre-check → parse → ingestRmsoloEvent.
//
// This module imports extractPdfText (which shells out to `pdftotext` via
// execFileSync). The admin route imports THIS module dynamically inside its
// handler so a serverless/edge build never statically bundles the child-process
// path into a hot module — and the route only reaches this code behind the
// INGEST_NOW_ENABLED capability gate below.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import type { IngestSummary } from "@/lib/ingest";
import { prisma as defaultClient } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { extractPdfText, parseRmsoloFullText } from "@/lib/rmsolo-parse";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import { fetchResultsPage, parseResultsPage } from "@/lib/rmsolo-index";

const POLITE_DELAY_MS = 1500;
const UA = "Mozilla/5.0 (compatible; launchcontrol-ingest)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same env var and fallback as ingestRmsoloEvent's own DEFAULT_LEAGUE_SLUG
// (rmsolo-ingest.ts) — kept in sync here so the sha pre-check below scopes to
// the exact same league that a non-skipped run would actually ingest into.
const DEFAULT_LEAGUE_SLUG = process.env.DEFAULT_LEAGUE_SLUG?.trim() || "pca-rmr";

// --- Capability probe ------------------------------------------------------

// The `pdftotext -v` shell-out is the expensive part; memoize only that (not
// the env read), so a deployment can flip INGEST_NOW_ENABLED without a probe
// re-run and tests can toggle the flag between assertions.
let pdftotextResolvable: boolean | undefined;
function hasPdftotext(): boolean {
  if (pdftotextResolvable === undefined) {
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
      pdftotextResolvable = true;
    } catch {
      pdftotextResolvable = false;
    }
  }
  return pdftotextResolvable;
}

/**
 * Whether on-demand ingest is available on this deployment: the operator opted
 * in via `INGEST_NOW_ENABLED=1` AND poppler's `pdftotext` (which the parser
 * shells out to) is resolvable on PATH. Returns a `reason` when disabled so the
 * route can surface a specific 501 and the dashboard can stay silent.
 */
export function ingestNowCapability(): { enabled: boolean; reason?: string } {
  if (process.env.INGEST_NOW_ENABLED !== "1") {
    return { enabled: false, reason: "INGEST_NOW_ENABLED is not set to 1 on this deployment" };
  }
  if (!hasPdftotext()) {
    return {
      enabled: false,
      reason: "pdftotext (poppler) was not found on PATH — install poppler to enable on-demand ingest",
    };
  }
  return { enabled: true };
}

// --- Per-league in-process mutex -------------------------------------------

// A single Node process must not run two overlapping scrapes for the same
// league (double-fetching rmsolo.org, racing the same rows). Scoped per league
// slug so an ingest of league A never blocks league B. In-process only — a
// multi-replica deployment would need a shared lock, but the target here is the
// single-container Docker artifact.
const ingestLocks = new Map<string, boolean>();

/**
 * Try to claim the ingest lock for `slug`. Returns a release function on
 * success, or `null` if a run is already in flight for that league. The
 * returned releaser is idempotent (safe to call from a `finally`).
 */
export function acquireIngestLock(slug: string): (() => void) | null {
  if (ingestLocks.get(slug)) return null;
  ingestLocks.set(slug, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ingestLocks.delete(slug);
  };
}

// --- Ingest ----------------------------------------------------------------

export type RmsoloRunCounts = {
  /** New or updated events written this run. */
  ingested: number;
  /** Events whose slug already existed with the same sha (ingestRmsoloEvent "unchanged"). */
  unchanged: number;
  /** Skipped before ingest: sha already present for this league, no Full PDF, or Pro Solo. */
  skipped: number;
  /** Events whose fetch/parse threw — logged loudly, do not abort the run. */
  failed: number;
};

/**
 * Ingest one downloaded PDF buffer into `leagueSlug`. Preserves the CLI's
 * league-scoped sha256 pre-check (cheap skip before shelling out to pdftotext),
 * mkdtemp temp-file handling, and best-effort per-event audit ("ingest"/"cli").
 * Returns the ingest summary, or `null` when the sha pre-check skipped it.
 *
 * Exported so the CLI's `--file` single-PDF path shares this exact code.
 */
export async function ingestBuffer(
  pdf: Buffer,
  sourceName: string,
  date: string,
  name: string | undefined,
  leagueSlug: string | undefined,
  client: PrismaClient = defaultClient,
): Promise<IngestSummary | null> {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const effectiveLeagueSlug = leagueSlug?.trim() || DEFAULT_LEAGUE_SLUG;
  // Cheap skip before we bother shelling out to pdftotext / parsing: if a
  // prior run already ingested this exact PDF INTO THIS LEAGUE, do nothing.
  // Scoped by league (not global) — the same PDF sha256 ingested into two
  // different leagues (e.g. a shared results source) must ingest into both,
  // not skip the second because the first already claimed that hash.
  // ingestRmsoloEvent itself provides slug-level idempotency (unchanged vs
  // update) beyond this.
  const existing = await client.event.findFirst({
    where: { sourceSha256: sha256, season: { league: { slug: effectiveLeagueSlug } } },
  });
  if (existing) {
    console.log(`[skip] ${sourceName} — already ingested (event ${existing.slug})`);
    return null;
  }
  const tmp = join(mkdtempSync(join(tmpdir(), "rmsolo-")), "event.pdf");
  writeFileSync(tmp, pdf);
  const parsed = parseRmsoloFullText(extractPdfText(tmp));
  const result = await ingestRmsoloEvent({ parsed, sha256, date, name, leagueSlug }, client);
  console.log(JSON.stringify(result, null, 2));
  try {
    await writeAudit(client, {
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

/**
 * Run the full RMsolo scrape loop for one league: fetch the results index,
 * then for each listed event download its Full PDF (with a 1.5s polite delay),
 * skipping Pro-Solo files (unsupported format) and events with no Full link,
 * and ingest the rest. One bad PDF is logged loudly and counted as `failed`
 * without aborting the season. Callers own their own audit — this writes only
 * the per-event "ingest" rows via {@link ingestBuffer}.
 */
export async function runRmsoloIngest({
  leagueSlug,
  client = defaultClient,
}: {
  leagueSlug: string | undefined;
  client?: PrismaClient;
}): Promise<RmsoloRunCounts> {
  const counts: RmsoloRunCounts = { ingested: 0, unchanged: 0, skipped: 0, failed: 0 };

  console.log("[ingest:rmsolo] fetching results index…");
  const { season, events } = parseResultsPage(await fetchResultsPage());
  console.log(`[ingest:rmsolo] season ${season}: ${events.length} event(s) listed`);

  for (const ev of events) {
    if (!ev.pdfUrls.full) {
      console.warn(`[skip] event #${ev.eventNumber} (${ev.date}) — no Full PDF link`);
      counts.skipped += 1;
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
      counts.skipped += 1;
      continue;
    }
    try {
      await sleep(POLITE_DELAY_MS);
      const res = await fetch(ev.pdfUrls.full, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${ev.pdfUrls.full}`);
      const result = await ingestBuffer(
        Buffer.from(await res.arrayBuffer()),
        basename(ev.pdfUrls.full),
        ev.date,
        undefined,
        leagueSlug,
        client,
      );
      if (result == null) counts.skipped += 1;
      else if (result.status === "ingested") counts.ingested += 1;
      else counts.unchanged += 1;
    } catch (e) {
      // One bad PDF must not block the season — log loudly, continue (spec: error handling).
      counts.failed += 1;
      console.error(`[FAIL] event #${ev.eventNumber} (${ev.date}):`, e);
    }
  }

  return counts;
}
