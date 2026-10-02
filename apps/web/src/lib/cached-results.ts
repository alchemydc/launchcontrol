import { cacheLife, cacheTag } from "next/cache";
import {
  buildDriverHistory,
  type DriverHistoryFilter,
  type DriverHistoryRow,
} from "@/lib/driver-history";
import { buildSeasonLeaderboard, type SeasonLeaderboardResult } from "@/lib/season-leaderboard";

/**
 * Cross-request caches for the two scoring computations that dominate
 * server CPU: season standings (every run of every entry in a season) and
 * driver history. Their output is viewer-independent — access gating runs
 * in the page before these are called — so one entry serves every visitor.
 *
 * Admin mutations expire `RESULTS_CACHE_TAG` immediately via
 * `expireResultsCache()`; the `hours` lifetime only bounds staleness for the
 * out-of-process ingest CLIs, which cannot reach this cache.
 *
 * Pages call these; tests and scripts keep calling the uncached builders
 * directly.
 */
export const RESULTS_CACHE_TAG = "results";

export async function cachedSeasonLeaderboard(
  target: number | { seasonId: number },
): Promise<SeasonLeaderboardResult> {
  "use cache";
  cacheLife("hours");
  cacheTag(RESULTS_CACHE_TAG);
  return typeof target === "number" ? buildSeasonLeaderboard(target) : buildSeasonLeaderboard(target);
}

export async function cachedDriverHistory(
  driverId: number,
  filter: DriverHistoryFilter = {},
): Promise<DriverHistoryRow[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(RESULTS_CACHE_TAG);
  return buildDriverHistory(driverId, filter);
}
