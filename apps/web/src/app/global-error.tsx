"use client";
// Root-layout error boundary (League Foundation PR 2 Task 7). error.tsx
// (this file's sibling) never wraps app/layout.tsx itself — only page.tsx
// and layouts nested below it — so a failure inside the root layout (e.g.
// getLeagueConfig() throwing there when the default League row is missing)
// would otherwise reach no boundary at all. global-error.tsx is Next's
// documented mechanism for exactly that case (see node_modules/next/dist/
// docs/01-app/03-api-reference/03-file-conventions/error.md, "Global Error"):
// it replaces the root layout when active, so it must define its own <html>
// and <body>. metadata/generateMetadata aren't supported here (error
// boundaries must be Client Components), hence the plain <title> element.
//
// No internals leaked: only the digest is rendered, never error.message —
// same rule as error.tsx.

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Launch Control</title>
        <main
          style={{
            maxWidth: "32rem",
            margin: "0 auto",
            padding: "6rem 1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#666", marginBottom: "1.5rem" }}>
            Launch Control hit an unexpected error loading the page. It&apos;s
            been logged — try again.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#999", marginBottom: "2rem" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #ccc",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
