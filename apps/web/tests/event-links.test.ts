import { describe, expect, it } from "vitest";
import { composeEventHref, historyRowEventHref } from "@/lib/event-links";

// PR #99 review, item 1: builders emit league-RELATIVE event hrefs
// (`/events/[slug]`, `/events/combined/[date]`) and views must compose them
// with the page's league base path. Rendering the suffix verbatim on an
// /l/[league] page resolved against the DEFAULT league and 404'd.

describe("composeEventHref (season-leaderboard score chips)", () => {
  it("prefixes the league base path on /l/[league] leaderboards", () => {
    expect(composeEventHref("/l/rmsolo", "/events/summer-2026-2")).toBe(
      "/l/rmsolo/events/summer-2026-2",
    );
    expect(composeEventHref("/l/rmsolo", "/events/combined/2026-06-14")).toBe(
      "/l/rmsolo/events/combined/2026-06-14",
    );
  });

  it("keeps legacy hrefs byte-identical with an empty base path", () => {
    expect(composeEventHref("", "/events/summer-2026-2")).toBe("/events/summer-2026-2");
  });
});

describe("historyRowEventHref (driver-history rows)", () => {
  const defaultRow = { href: "/events/e1", leagueSlug: "pca-rmr" };
  const foreignRow = { href: "/events/e1", leagueSlug: "rmsolo" };
  const foreignCombined = { href: "/events/combined/2026-06-14", leagueSlug: "rmsolo" };

  it("uses the locked base path for every row on /l/[league]/drivers/[id]", () => {
    expect(historyRowEventHref(foreignRow, "/l/rmsolo", "pca-rmr")).toBe(
      "/l/rmsolo/events/e1",
    );
  });

  it("keeps default-league rows unprefixed on the legacy page (byte-identical)", () => {
    expect(historyRowEventHref(defaultRow, "", "pca-rmr")).toBe("/events/e1");
  });

  it("links a ?league=all foreign-league row into its OWN league, not the default", () => {
    expect(historyRowEventHref(foreignRow, "", "pca-rmr")).toBe("/l/rmsolo/events/e1");
    expect(historyRowEventHref(foreignCombined, "", "pca-rmr")).toBe(
      "/l/rmsolo/events/combined/2026-06-14",
    );
  });
});
