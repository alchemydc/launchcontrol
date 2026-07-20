"use client";
import { useRouter } from "next/navigation";

export function BackButton({
  fallbackHref,
  label = "← Back",
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === "undefined") return;
        let sameOrigin = false;
        if (document.referrer) {
          try {
            sameOrigin =
              new URL(document.referrer).origin === window.location.origin;
          } catch {
            sameOrigin = false;
          }
        }
        // document.referrer is empty for typed/bookmarked initial loads and
        // stays empty across App Router soft navigations, so it alone can't
        // see in-app history. If there are history entries to go back to and
        // no *external* referrer, prefer real history over the fallback.
        const canGoBack =
          sameOrigin || (document.referrer === "" && window.history.length > 1);
        if (canGoBack) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
    </button>
  );
}
