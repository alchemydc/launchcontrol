"use client";
// App-level error boundary (League Foundation PR 2 Task 7). Wraps page.tsx
// and every nested layout below the root layout in a React error boundary
// (Next.js file convention — see node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/error.md) — this is what catches, e.g., a
// malformed Season.scoringPolicy throwing out of parseScoringPolicy() inside
// a page-level Server Component (event/season/combined pages all resolve
// their season's policy server-side).
//
// It does NOT catch errors thrown by the root layout (app/layout.tsx) itself
// — e.g. getLeagueConfig() failing there when the default League row is
// missing — since error.js never wraps the layout.js of its own segment.
// That failure mode is handled by the sibling global-error.tsx instead.
//
// No internals leaked: Server Component errors already arrive here with a
// generic message and a `digest` (Next redacts the real message/stack in
// production — see the error.js docs) — we never render `error.message`,
// only the digest, so nothing server-side leaks even if that redaction were
// ever bypassed.

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Mirrors the error to the browser console (dev + prod) — the digest
    // here is the same identifier that appears in the server-side log line
    // for this failure, so a user report including it is traceable.
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main className="w-full mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-24 text-center">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
        Something went wrong
      </h1>
      <p className="text-muted-foreground mb-6">
        We hit an unexpected error loading this page. It&apos;s been logged — try
        again, or head back home.
      </p>
      {error.digest && (
        <p className="text-xs font-mono text-muted-foreground/70 mb-8">
          Reference: {error.digest}
        </p>
      )}
      <div className="flex items-center justify-center gap-4">
        <Button onClick={() => unstable_retry()}>Try again</Button>
        <Link href="/" className="text-primary hover:underline text-sm">
          Go home
        </Link>
      </div>
    </main>
  );
}
