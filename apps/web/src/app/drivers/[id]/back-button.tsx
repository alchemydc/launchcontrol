"use client";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === "undefined") return;
        // Next.js App Router sets __NA: true on every in-app history entry.
        // Checking both __NA and length > 1 prevents router.back() from
        // escaping to an external site when the user arrived directly.
        const state = window.history.state as { __NA?: boolean } | null;
        if (state?.__NA && window.history.length > 1) {
          router.back();
        } else {
          router.push("/leaderboard");
        }
      }}
      className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
    >
      ← Back
    </button>
  );
}
