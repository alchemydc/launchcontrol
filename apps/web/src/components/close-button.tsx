"use client";
import { useRouter } from "next/navigation";

export function CloseButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Close"
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
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
    >
      &times;
    </button>
  );
}
