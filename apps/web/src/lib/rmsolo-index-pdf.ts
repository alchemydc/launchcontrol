/**
 * Parser for RMsolo "Indexed Results" PDFs (the INDEX button on the results
 * page), run through `pdftotext -layout`.
 *
 * The Full PDF's run-group sections (M/N/S/P/X) print each driver's PAX-indexed
 * Best but never the class that factor came from. The Index PDF does: every row
 * carries the full class ("X/SST", "N/CS", "PS-CAM/CAMC") and the factor that
 * was applied. Ingest uses these rows to give run-group entries their real
 * paxClass instead of guessing it from the factor, which goes wrong whenever a
 * season's factors differ from the built-in 2026 table (e.g. 2024 SST was 0.836,
 * the 2026 AST factor).
 *
 * The layout changed over the years (2017 marker column, Pronto's extra "Nbr"
 * column, 2025+ "Behind/From First/Points"), but every variant keeps the same
 * core sequence this parser keys on:
 *   Pos [Nbr] Name   Class  Num  Time  Index  IndexTime ...
 * Pure string parsing, no I/O.
 */

export type RmsoloIndexRow = {
  /** Lowercased, whitespace-collapsed driver name; "" when the PDF prints none. */
  name: string;
  carNumber: string;
  /** Class exactly as printed, e.g. "X/SST" or "AS". */
  classCode: string;
  /** Run-group prefix before the last "/", e.g. "X", "PS-CAM"; null for a plain class. */
  group: string | null;
  /** The class the factor belongs to: the part after the last "/". */
  baseClass: string;
  /** Applied PAX factor, as printed. */
  factor: number;
};

// [optional single-letter marker] Pos [Nbr] Name  Class Num Time Index IndexTime
// The name is separated from the class by 2+ spaces (it may itself be empty);
// the class and number can be squeezed to a single space by the layout.
// A driver with no clean run prints "No Time" in both time columns.
const ROW_RE =
  /^\s*(?:[A-Z]\s+)?\d+\s+(?:\d+\s+)?(.*?)\s{2,}(\S+)\s+(\d+)\s+(?:\d+\.\d{3}|No Time)\s+(\d\.\d{3})\s+(?:\d+\.\d{3}\b|No Time)/;
// A real class token: letters/digits/hyphens, optionally "GROUP/CLASS".
const CLASS_RE = /^[A-Za-z][A-Za-z0-9-]*(?:\/[A-Za-z][A-Za-z0-9-]*)?$/;

export function normalizeIndexName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Lookup key shared by Index rows and Full-PDF entries: name + car number. */
export function indexClassKey(firstName: string, lastName: string, carNumber: string): string {
  return `${normalizeIndexName(`${firstName} ${lastName}`)}|${carNumber.trim()}`;
}

export function parseRmsoloIndexText(text: string): RmsoloIndexRow[] {
  const rows: RmsoloIndexRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, rawName, classCode, carNumber, factorStr] = m;
    if (!CLASS_RE.test(classCode!)) continue; // garbled row (e.g. a factor landed in the class column)
    const factor = Number(factorStr);
    if (!(factor > 0.4 && factor <= 1.0)) continue; // no real PAX factor lies outside this range
    const slash = classCode!.lastIndexOf("/");
    rows.push({
      name: normalizeIndexName(rawName ?? ""),
      carNumber: carNumber!,
      classCode: classCode!,
      group: slash >= 0 ? classCode!.slice(0, slash) : null,
      baseClass: slash >= 0 ? classCode!.slice(slash + 1) : classCode!,
      factor,
    });
  }
  return rows;
}
