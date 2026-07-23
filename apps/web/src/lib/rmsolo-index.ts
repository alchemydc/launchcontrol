/**
 * Scraper for the RMsolo public results page (https://www.rmsolo.org/results/).
 *
 * The page renders a single table for the season currently selected in a
 * "Results folder" dropdown (default: the current/most-recent season). Each
 * row looks like:
 *
 *   <tr>
 *     <td class="col-event"><span class="rmsolo-event-circle">1</span></td>
 *     <td class="col-date">Apr 18</td>
 *     <td class="col-results">
 *       <div class="rmsolo-buttons">
 *         <a class="rmsolo-btn rmsolo-full" href="https://www.rmsolo.org/wp-content/uploads/2026/05/ss1-0418_Full.pdf" ...>FULL</a>
 *         <a class="rmsolo-btn rmsolo-index" href="...Index-7.pdf" ...>INDEX</a>
 *         <a class="rmsolo-btn rmsolo-novice" href="...Novice-7.pdf" ...>NOVICE</a>
 *       </div>
 *     </td>
 *     <td class="col-sound"></td>
 *   </tr>
 *
 * Observed in the wild: a trailing row can reuse an earlier event number, have
 * an empty date cell, and carry no result buttons at all — just a sound-log
 * PDF in the SOUND column (e.g. a shared "sound_logs_EVOC.pdf" for one of the
 * events). Rows without a parseable date and without at least one results PDF
 * are not real events and must be skipped.
 *
 * This module is regex/string parsing only — no HTML parser dependency.
 */

export type RmsoloEventRef = {
  eventNumber: number;
  date: string; // YYYY-MM-DD (year from the page's season header)
  pdfUrls: { full?: string; index?: string; raw?: string; novice?: string };
};

export const RMSOLO_RESULTS_URL = "https://www.rmsolo.org/results/";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

// The selected <option> in the season dropdown, e.g.
// <option value="..." selected='selected'>2026 Championship Series</option>
const SEASON_RE = /<option\b[^>]*\bselected=['"]selected['"][^>]*>\s*(\d{4})/i;

// One table row. Non-greedy body capture stops at the next </tr>.
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

// First number inside the event-number cell, e.g. <span class="rmsolo-event-circle">1</span>
const EVENT_NUMBER_RE = /class="[^"]*rmsolo-event-circle[^"]*"[^>]*>\s*(\d+)/i;

// The DATE column: <td class="col-date">Apr 18</td> (may be empty for non-event rows).
const DATE_CELL_RE = /<td\s+class="col-date">\s*([A-Za-z]{3})\s+(\d{1,2})\s*<\/td>/i;

// PDF links anywhere in the row (results buttons or the sound-log link).
const PDF_LINK_RE = /<a\b([^>]*)href="([^"]+\.pdf)"([^>]*)>([\s\S]*?)<\/a>/gi;

type Variant = "full" | "index" | "raw" | "novice";

function classifyVariant(anchorAttrsBefore: string, anchorAttrsAfter: string, linkText: string, url: string): Variant | null {
  const haystack = `${anchorAttrsBefore} ${anchorAttrsAfter} class="${linkText}" ${url}`;
  // Order matters: check the more specific tokens first. "raw" and "index" are
  // substrings that could otherwise collide with filenames, but in practice
  // the CSS class (rmsolo-full/-index/-raw/-novice) and button text (FULL/
  // INDEX/RAW/NOVICE) are unambiguous, so a straightforward first-match wins.
  if (/rmsolo-full|\bfull\b|_full/i.test(haystack)) return "full";
  if (/rmsolo-index|\bindex\b|_index/i.test(haystack)) return "index";
  if (/rmsolo-raw|\braw\b|_raw/i.test(haystack)) return "raw";
  if (/rmsolo-novice|\bnovice\b|_novice/i.test(haystack)) return "novice";
  return null;
}

function resolveUrl(href: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (baseUrl) return new URL(href, baseUrl).toString();
  return href;
}

export function parseResultsPage(html: string, baseUrl?: string): { season: number; events: RmsoloEventRef[] } {
  const seasonMatch = html.match(SEASON_RE);
  if (!seasonMatch) {
    throw new Error("parseResultsPage: could not find the selected season year in the results-folder dropdown");
  }
  const season = Number(seasonMatch[1]);

  const events: RmsoloEventRef[] = [];

  for (const rowMatch of html.matchAll(ROW_RE)) {
    const row = rowMatch[1]!;

    const eventNumberMatch = row.match(EVENT_NUMBER_RE);
    const dateMatch = row.match(DATE_CELL_RE);
    if (!eventNumberMatch || !dateMatch) continue; // header row, or a non-event (e.g. sound-only) row

    const [, monthAbbrev, dayStr] = dateMatch;
    const month = MONTHS[monthAbbrev as string];
    if (!month) continue; // unrecognized month token — not a real date cell

    const pdfUrls: RmsoloEventRef["pdfUrls"] = {};
    for (const linkMatch of row.matchAll(PDF_LINK_RE)) {
      const [, attrsBefore, href, attrsAfter, text] = linkMatch;
      const variant = classifyVariant(attrsBefore ?? "", attrsAfter ?? "", text ?? "", href ?? "");
      if (!variant) continue;
      pdfUrls[variant] = resolveUrl(href!, baseUrl);
    }

    // The trailing sound-only row is already skipped above by the !dateMatch
    // check (its col-date cell is empty). This check is a defensive guard for
    // any date-bearing row that nonetheless has no results PDFs, so ingest
    // never emits a bogus event for it.
    if (!pdfUrls.full && !pdfUrls.index && !pdfUrls.raw && !pdfUrls.novice) continue;

    const day = (dayStr as string).padStart(2, "0");
    events.push({
      eventNumber: Number(eventNumberMatch[1]),
      date: `${season}-${month}-${day}`,
      pdfUrls,
    });
  }

  return { season, events };
}

export async function fetchResultsPage(): Promise<string> {
  const res = await fetch(RMSOLO_RESULTS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; launchcontrol-ingest)" },
  });
  if (!res.ok) {
    throw new Error(`fetchResultsPage: ${RMSOLO_RESULTS_URL} responded ${res.status} ${res.statusText}`);
  }
  return res.text();
}
