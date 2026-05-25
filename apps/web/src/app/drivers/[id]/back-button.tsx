"use client";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
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
