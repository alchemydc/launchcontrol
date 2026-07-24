import { revalidatePath } from "next/cache";

/**
 * Expire every ISR-cached results page (leaderboards, events, home) after an
 * admin mutation, so uploads/edits/deletes are visible immediately instead of
 * after the 5-minute revalidate window. The out-of-process RMsolo ingest CLI
 * cannot call this — its updates surface via time-based revalidation.
 */
export function expireResultsCache(): void {
  revalidatePath("/leaderboard", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/l", "layout");
  revalidatePath("/");
}
