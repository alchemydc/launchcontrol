// tests/rmsolo-index.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResultsPage, RMSOLO_RESULTS_URL } from "@/lib/rmsolo-index";

const html = readFileSync(join(__dirname, "fixtures", "rmsolo-results-page.html"), "utf8");

describe("parseResultsPage", () => {
  it("detects the season year from the selected dropdown option", () => {
    expect(parseResultsPage(html).season).toBe(2026);
  });

  it("lists events with ISO dates and absolute PDF URLs", () => {
    const { events } = parseResultsPage(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0]!;
    expect(first.date).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(first.pdfUrls.full).toMatch(/^https:\/\/www\.rmsolo\.org\/wp-content\/uploads\/.*\.pdf$/i);
  });

  it("tolerates events with missing variants (e.g. no RAW)", () => {
    const { events } = parseResultsPage(html);
    for (const e of events) {
      expect(e.pdfUrls.full ?? e.pdfUrls.index ?? e.pdfUrls.novice).toBeDefined();
    }
  });

  it("parses all six real events in event-number and date order, skipping the sound-only row", () => {
    const { events } = parseResultsPage(html);
    // The fixture's last <tr> reuses event-circle "3", has an empty date cell, and no
    // results buttons — it's a sound-log-only row appended after the real event rows.
    // It must not surface as a 7th event or corrupt event 3.
    expect(events.map((e) => e.eventNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((e) => e.date)).toEqual([
      "2026-04-18",
      "2026-04-26",
      "2026-05-02",
      "2026-05-16",
      "2026-05-30",
      "2026-06-14",
    ]);
  });

  it("resolves absolute PDF URLs exactly as captured, with all links present when the page has them", () => {
    const { events } = parseResultsPage(html);
    const event2 = events.find((e) => e.eventNumber === 2)!;
    expect(event2.pdfUrls).toEqual({
      full: "https://www.rmsolo.org/wp-content/uploads/2026/05/ss2-0426_full.pdf",
      index: "https://www.rmsolo.org/wp-content/uploads/2026/05/ss2-0426_index-7.pdf",
      raw: "https://www.rmsolo.org/wp-content/uploads/2026/05/ss2-0426_raw-7.pdf",
      novice: "https://www.rmsolo.org/wp-content/uploads/2026/05/ss2-0426_novice-7.pdf",
    });
  });

  it("event 1 has no RAW variant in the real fixture — omits the key rather than fabricating a value", () => {
    const { events } = parseResultsPage(html);
    const event1 = events.find((e) => e.eventNumber === 1)!;
    expect(event1.pdfUrls.raw).toBeUndefined();
    expect(event1.pdfUrls.full).toBe("https://www.rmsolo.org/wp-content/uploads/2026/05/ss1-0418_Full.pdf");
    expect(event1.pdfUrls.index).toBe("https://www.rmsolo.org/wp-content/uploads/2026/05/ss1-0418_Index-7.pdf");
    expect(event1.pdfUrls.novice).toBe("https://www.rmsolo.org/wp-content/uploads/2026/05/ss1-0418_Novice-7.pdf");
  });

  it("resolves relative hrefs against a supplied baseUrl", () => {
    const relativeHtml = html.replace(
      /https:\/\/www\.rmsolo\.org\/wp-content\/uploads/g,
      "/wp-content/uploads",
    );
    const { events } = parseResultsPage(relativeHtml, "https://www.rmsolo.org");
    expect(events[0]!.pdfUrls.full).toBe("https://www.rmsolo.org/wp-content/uploads/2026/05/ss1-0418_Full.pdf");
  });

  it("exposes the canonical results URL", () => {
    expect(RMSOLO_RESULTS_URL).toBe("https://www.rmsolo.org/results/");
  });
});
