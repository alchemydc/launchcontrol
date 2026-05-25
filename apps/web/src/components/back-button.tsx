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
        if (sameOrigin) {
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
