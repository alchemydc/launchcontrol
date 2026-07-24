import { describe, it, expect } from "vitest";
import { parseFilter } from "@/app/drivers/[id]/driver-page-view";

// Task 20 fix: the locked league page (`/l/[league]/drivers/[id]`) pins
// `filter.leagueIds` to the locked league, but a `?season=` param must ALSO
// be validated against that league -- `resolveScope` in driver-history.ts
// lets `seasonId` win over `leagueIds`, so an unvalidated cross-league
// `?season=` would otherwise escape the lock and render another league's
// (possibly gated) history on the locked page.

const rmrLeague = { id: 1, slug: "pca-rmr" };
const rmsoloLeague = { id: 2, slug: "rmsolo" };

const seasons = [
  { seasonId: 100, leagueId: rmrLeague.id }, // belongs to pca-rmr
  { seasonId: 200, leagueId: rmsoloLeague.id }, // belongs to rmsolo
];

describe("parseFilter — locked league page season validation", () => {
  it("honors a ?season= that belongs to the locked league", () => {
    const { filter, current } = parseFilter(
      { season: "200" },
      [],
      seasons,
      rmsoloLeague,
      true,
    );
    expect(filter.leagueIds).toEqual([rmsoloLeague.id]);
    expect(filter.seasonId).toBe(200);
    expect(current.timeScope).toBe("season");
    expect(current.seasonId).toBe(200);
  });

  it("drops a ?season= belonging to a DIFFERENT league, falling back to the locked league's default scope", () => {
    const { filter, current } = parseFilter(
      { season: "100" }, // pca-rmr's season id, requested on the rmsolo-locked page
      [],
      seasons,
      rmsoloLeague,
      true,
    );
    expect(filter.leagueIds).toEqual([rmsoloLeague.id]);
    expect(filter.seasonId).toBeUndefined();
    expect(current.timeScope).toBe("all");
    expect(current.seasonId).toBeUndefined();
  });

  it("drops an unknown/nonexistent ?season= id on a locked page", () => {
    const { filter, current } = parseFilter(
      { season: "999999" },
      [],
      seasons,
      rmsoloLeague,
      true,
    );
    expect(filter.leagueIds).toEqual([rmsoloLeague.id]);
    expect(filter.seasonId).toBeUndefined();
    expect(current.timeScope).toBe("all");
  });

  it("falls back to a from/to range on a locked page when the season is cross-league and a range is also given", () => {
    const { filter, current } = parseFilter(
      { season: "100", from: "2026-01-01", to: "2026-02-01" },
      [],
      seasons,
      rmsoloLeague,
      true,
    );
    expect(filter.leagueIds).toEqual([rmsoloLeague.id]);
    expect(filter.seasonId).toBeUndefined();
    expect(current.timeScope).toBe("range");
    expect(current.from).toBe("2026-01-01");
    expect(current.to).toBe("2026-02-01");
  });

  it("ignores ?league= entirely on a locked page (pre-existing behavior, unaffected by this fix)", () => {
    const { filter, current } = parseFilter(
      { league: "pca-rmr" },
      [],
      seasons,
      rmsoloLeague,
      true,
    );
    expect(filter.leagueIds).toEqual([rmsoloLeague.id]);
    expect(current.league).toBe(rmsoloLeague.slug);
  });

  it("still honors ANY ?season= on the legacy unlocked page, regardless of league (byte-identical legacy behavior)", () => {
    const { filter, current } = parseFilter(
      { season: "100" },
      [rmrLeague, rmsoloLeague],
      seasons,
      rmsoloLeague, // default league differs from the season's league
      false,
    );
    expect(filter.seasonId).toBe(100);
    expect(current.timeScope).toBe("season");
    expect(current.seasonId).toBe(100);
  });
});
