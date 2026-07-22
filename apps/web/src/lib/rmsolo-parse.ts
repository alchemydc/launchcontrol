import { execFileSync } from "node:child_process";

export type ParsedRun = { seconds: number; cones: number; disposition: "CLEAN" | "DNF" };
export type ParsedEntry = {
  classCode: string;
  position: number;
  trophy: boolean;
  carNumber: string;
  altCarNumber: string | null; // co-drive cross-reference "(118)"
  firstName: string;
  lastName: string;
  carDescription: string | null;
  hometown: string | null;
  bestSeconds: number | null; // printed Best column; null for all-DNS entries
  runs: ParsedRun[]; // DNS slots omitted entirely
};
export type ParsedRmsoloEvent = { title: string; classCodes: string[]; entries: ParsedEntry[] };

/** Shells out to poppler's pdftotext. CLI-only — never imported by app routes. */
export function extractPdfText(pdfPath: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  } catch (e) {
    throw new Error(
      `pdftotext failed for ${pdfPath} — is poppler installed? (brew install poppler / apt install poppler-utils)\n${String(e)}`,
    );
  }
}

const HEADER_RE = /^Pos\s+#\s+Name\s+Runs\s+Best\s*$/;
// "Pro Solo" results (RT/60ft-per-run, two-run "Total" instead of a "Best" of
// up to 7) are a structurally different format this parser does not support —
// detected by the same column header ending in "Total" instead of "Best".
const PRO_HEADER_RE = /^Pos\s+#\s+Name\s+Runs\s+Total\s*$/;
// Class heading lines are short, all-caps (plus digits), e.g. "AS", "BS", "XU", "N".
const CLASS_RE = /^[A-Z][A-Z0-9]{0,5}$/;
// One run/best token. Order matters: concatenated disposition prefix (e.g. DNF45.993) before bare disposition.
const TOKEN_RE = /(DNF|DNS|RRN|OFF|DSQ)?(\d+\.\d{3})(\+\d+)?|(DNF|DNS|RRN|OFF|DSQ)/g;
// Identity zone: optional trophy marker (flexible spacing "T1"/"T 3"), position, car number
// (optionally parenthesized on continuation lines), then the rest (name / car description).
// The trailing "whitespace + rest" is itself optional: real RMsolo PDFs include blank-name
// co-drive placeholder rows (car number only, no name/car text at all — observed in the wild)
// and without this the row silently falls through to the continuation branch, corrupting the
// *previous* entry with extra run tokens instead of starting its own (nameless) entry.
const ENTRY_START_RE = /^\s*(T)?\s*(\d+)\s+\(?(\d+)\)?(?:\s+(.*))?$/;

type Token = { start: number; raw: string; disp: string | null; seconds: number | null; cones: number };

function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const rawTokens: Token[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const [, disp1, secs, cones, disp2] = m;
    if (disp1 != null && secs != null) {
      // Concatenated form ("29.153 DNF46.403" → token "DNF46.403"): column
      // squeeze ate the space between a suffix disposition marker (which
      // belongs to the PRECEDING time — see the merge rule below) and the
      // NEXT run's time. Split into two logical tokens so the marker merges
      // backward and the digits stand alone as their own (clean) run slot.
      // Proven against real data (RMsolo Summer 2026#2, AST, Patryk Matecki):
      // "50.151  29.153 DNF46.403  46.751+1" with printed Best 46.403 — only
      // the split reading (29.153 DNF'd; 46.403 clean) reconciles, since a
      // clean 29.153 would have to BE the Best.
      rawTokens.push({ start: m.index, raw: disp1, disp: disp1, seconds: null, cones: 0 });
      rawTokens.push({
        start: m.index + disp1.length,
        raw: m[0].slice(disp1.length),
        disp: null,
        seconds: Number(secs),
        cones: cones != null ? Number(cones.slice(1)) : 0,
      });
      continue;
    }
    rawTokens.push({
      start: m.index,
      raw: m[0],
      disp: disp1 ?? disp2 ?? null,
      seconds: secs != null ? Number(secs) : null,
      cones: cones != null ? Number(cones.slice(1)) : 0,
    });
  }
  for (const token of rawTokens) {
    // The DNF marker is a SUFFIX of the run it belongs to: RMsolo PDFs print
    // a run's elapsed time, then "DNF" — either space-delimited ("47.188 DNF
    // 47.253", Summer 2026#1, CST, Micah Schaubroeck) or with the following
    // run's time squeezed against it ("29.153 DNF46.403", split into marker +
    // time tokens above). Either way the bare marker is not its own run slot —
    // it retroactively marks the immediately preceding untagged time as the
    // DNF, so the pair collapses into ONE run (disposition DNF, seconds from
    // that time), never two (a phantom clean run plus a spurious 0-second DNF
    // run). Confirmed against real data: only this collapsed reading makes
    // every entry's printed Best equal min-over-clean-runs.
    // Bare DNS never needs this: an untagged time followed by a bare DNS is
    // legitimately two slots (a recorded run, then a separate not-started
    // attempt) — DNS rows are dropped entirely downstream regardless, so no
    // merge is needed or correct there.
    const prev = out[out.length - 1];
    if (token.disp === "DNF" && token.seconds == null && prev && prev.disp == null && prev.seconds != null) {
      out[out.length - 1] = { start: prev.start, raw: `${prev.raw} ${token.raw}`, disp: "DNF", seconds: prev.seconds, cones: prev.cones };
      continue;
    }
    out.push(token);
  }
  return out;
}

export function parseRmsoloFullText(text: string): ParsedRmsoloEvent {
  const lines = text.split(/\r?\n/);
  let title = "";
  let currentClass: string | null = null;
  let bestCol = -1;
  const classCodes: string[] = [];
  const entries: ParsedEntry[] = [];
  let entry: ParsedEntry | null = null;

  const flush = () => {
    if (entry) entries.push(entry);
    entry = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine == null) continue;
    const line = rawLine.replace(/\f/g, "");
    const trimmed = line.trim();

    if (trimmed === "" || trimmed === "Results") continue;

    // Class heading: short all-caps line whose NEXT non-blank line is the column header.
    if (CLASS_RE.test(trimmed)) {
      const next = lines[i + 1]?.trim() ?? "";
      if (HEADER_RE.test(next)) {
        flush();
        currentClass = trimmed;
        if (!classCodes.includes(trimmed)) classCodes.push(trimmed);
        const headerLine = lines[i + 1];
        bestCol = headerLine ? headerLine.indexOf("Best") : -1;
        if (bestCol < 0) {
          throw new Error(`[rmsolo-parse] header line at ${i + 2} missing 'Best' column: ${next}`);
        }
        i += 1; // consume header line
        continue;
      }
      if (PRO_HEADER_RE.test(next)) {
        throw new Error(
          "[rmsolo-parse] this file looks like a Pro Solo results PDF (column header ends in 'Total', not 'Best') — Pro Solo events are not supported by this parser.",
        );
      }
    }

    // Title: the line before any class section appears (repeated on every page).
    if (currentClass == null) {
      if (title === "") title = trimmed;
      continue;
    }
    if (trimmed === title) continue; // repeated page title

    const tokens = tokenize(line);
    const runTokens = tokens.filter((t) => t.start < bestCol - 3);
    const rightTokens = tokens.filter((t) => t.start >= bestCol - 3);
    const identityEnd = tokens.length > 0 ? tokens[0]!.start : line.length;
    const identityZone = line.slice(0, identityEnd).trimEnd();

    const startMatch = identityZone.match(ENTRY_START_RE);
    // Continuation lines (hometown, or "(alt)" + hometown) never match ENTRY_START_RE:
    // its identity zone is either blank, "(144)", or "Faketown, CO" — none begin with the
    // "position digits, then car-number digits" shape the regex requires. So a plain
    // startMatch != null check (no extra "already 2 lines into this entry" guard) reliably
    // distinguishes a new entry from a continuation across the fixture and the real PDF alike.
    const looksLikeStart = startMatch != null;

    if (looksLikeStart) {
      flush();
      const [, trophy, pos, num, rest] = startMatch;
      // rest = "Name   Car description" — split on 2+ spaces (column padding).
      const parts = (rest ?? "").trim().split(/\s{2,}/);
      const fullName = (parts[0] ?? "").trim();
      const nameWords = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameWords.length > 1 ? nameWords.slice(0, -1).join(" ") : (nameWords[0] ?? "");
      const lastName = nameWords.length > 1 ? nameWords[nameWords.length - 1]! : "";
      entry = {
        classCode: currentClass,
        position: Number(pos),
        trophy: trophy === "T",
        carNumber: num!,
        altCarNumber: null,
        firstName,
        lastName,
        carDescription: parts.slice(1).join(" ").trim() || null,
        hometown: null,
        bestSeconds: null,
        runs: [],
      };
      // Best column value on line 1 (may be DNS for all-DNS entries — bestSeconds
      // already defaults to null above and is only overwritten when numeric).
      const best = rightTokens[rightTokens.length - 1];
      if (best?.seconds != null) entry.bestSeconds = best.seconds;
    } else if (entry) {
      // Continuation line: optional "(alt-number)" + optional hometown in the identity zone.
      const alt = identityZone.match(/\((\d+)\)/);
      if (alt) entry.altCarNumber = alt[1]!;
      const homeText = identityZone.replace(/\(\d+\)/, "").trim();
      if (homeText && entry.hometown == null) entry.hometown = homeText;
      // rightTokens on line 2 = gap-to-previous — intentionally discarded (not part of contract).
    } else {
      // Stray line outside any entry block (defensive — shouldn't happen with well-formed input).
      throw new Error(
        `[rmsolo-parse] line ${i + 1} in class '${currentClass}' is neither an entry start nor a continuation: ${JSON.stringify(line)}`,
      );
    }

    for (const t of runTokens) {
      if (t.disp === "DNS") continue; // no run row for DNS slots
      if (t.disp === "DNF") {
        entry!.runs.push({ seconds: t.seconds ?? 0, cones: t.cones, disposition: "DNF" });
      } else if (t.disp != null) {
        // RRN / OFF / DSQ observed in the token grammar but never seen in real RMsolo
        // output; fail loudly rather than silently mis-recording an unknown disposition.
        throw new Error(
          `[rmsolo-parse] unrecognized run disposition '${t.disp}' at line ${i + 1}: ${trimmed}`,
        );
      } else if (t.seconds != null) {
        entry!.runs.push({ seconds: t.seconds, cones: t.cones, disposition: "CLEAN" });
      }
    }
  }
  flush();

  if (title === "") throw new Error("[rmsolo-parse] no event title found — not an RMsolo Full results PDF?");
  if (entries.length === 0) throw new Error("[rmsolo-parse] no entries parsed — layout change?");
  return { title, classCodes, entries };
}

const CONE_SECONDS = 2.0; // SCCA Solo standard; must stay consistent with CONE_PENALTY_MS
const EPS = 0.0005;

export type ReconcileResult = {
  interpretation: "raw" | "penalized";
  /** Best-bearing entries whose printed Best matched neither interpretation
   * (e.g. real RMsolo "run-group" headings — M/N/S/P/X — print each driver's
   * PAX-indexed Best rather than raw, mixing classes under one heading; see
   * rmsolo-pax.ts). Callers should not commit a best run for these. */
  unreconciled: ParsedEntry[];
};

/**
 * Determines whether printed run times are raw (penalty added for scoring) or
 * already penalized, by checking which interpretation makes a clear majority
 * of entries' printed Best equal min over CLEAN runs. Real RMsolo "Full" PDFs
 * mix in run-group headings (observed: M, N, S, P, X) whose printed Best is
 * PAX-indexed per-driver rather than raw/penalized — one uniform interpretation
 * can never fit those entries, so they're reported back as unreconciled instead
 * of failing the whole event. Only throws if no interpretation fits a majority
 * of best-bearing entries — protection against a genuine layout/scoring change
 * or a garbage file, which we must not guess through.
 */
export function reconcileTimes(event: ParsedRmsoloEvent): ReconcileResult {
  const matches = (e: ParsedEntry, total: (r: ParsedRun) => number): boolean => {
    if (e.bestSeconds == null) return e.runs.every((r) => r.disposition !== "CLEAN") || e.runs.length === 0;
    const clean = e.runs.filter((r) => r.disposition === "CLEAN");
    if (clean.length === 0) return false;
    const min = Math.min(...clean.map(total));
    return Math.abs(min - e.bestSeconds) < EPS;
  };

  const bestBearing = event.entries.filter((e) => e.bestSeconds != null);
  const rawTotal = (r: ParsedRun): number => r.seconds + r.cones * CONE_SECONDS;
  const penalizedTotal = (r: ParsedRun): number => r.seconds;
  const isMajority = (count: number): boolean => bestBearing.length > 0 && count > bestBearing.length / 2;

  const rawCount = bestBearing.filter((e) => matches(e, rawTotal)).length;
  if (isMajority(rawCount)) {
    return { interpretation: "raw", unreconciled: bestBearing.filter((e) => !matches(e, rawTotal)) };
  }
  const penalizedCount = bestBearing.filter((e) => matches(e, penalizedTotal)).length;
  if (isMajority(penalizedCount)) {
    return { interpretation: "penalized", unreconciled: bestBearing.filter((e) => !matches(e, penalizedTotal)) };
  }
  throw new Error(
    "[rmsolo-parse] Best column matches neither raw+penalty nor penalized interpretation for a majority of entries — investigate before ingesting.",
  );
}
