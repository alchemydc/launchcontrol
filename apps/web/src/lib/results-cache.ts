import { revalidatePath, revalidateTag } from "next/cache";
import { RESULTS_CACHE_TAG } from "@/lib/cached-results";

/**
 * Expire every cached results page and the cross-request scoring caches
 * (`cached-results.ts`) after an admin mutation, so uploads/edits/deletes are
 * visible immediately. The out-of-process ingest CLIs cannot call this —
 * their updates surface when the cache TTL lapses.
 */
export function expireResultsCache(): void {
  revalidateTag(RESULTS_CACHE_TAG, { expire: 0 });
  revalidatePath("/leaderboard", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/l", "layout");
  revalidatePath("/");
}
