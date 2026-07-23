import Link from "next/link";
import { BackButton } from "@/components/back-button";
import type { CombinedResults } from "@/lib/combined-event";
import { CombinedTable } from "./combined-table";

export function CombinedResultsView({
  results,
  dateLabel,
  photosUrl,
  basePath = "",
}: {
  results: CombinedResults;
  dateLabel: string;
  photosUrl: string | null;
  /** "" for the legacy route (byte-identical to pre-Task-5 hrefs), "/l/[slug]"
   *  for league-scoped. */
  basePath?: string;
}) {
  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="mb-3 flex items-center gap-3">
          <BackButton fallbackHref={basePath || "/"} />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
            {dateLabel} · Combined event
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{results.label}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Ranked by summed best-corrected time across every session. A driver scores
                only when they posted a countable time in the same class in every session.
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {results.sessions.map((s) => (
                  <Link key={s.id} href={`${basePath}/events/${s.slug}`} className="text-primary hover:underline">
                    {s.name} ↗
                  </Link>
                ))}
              </div>
            </div>
          </div>
          {photosUrl && (
            <a
              href={photosUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm shrink-0"
            >
              Photos ↗
            </a>
          )}
        </div>
      </header>

      <CombinedTable results={results} />
    </main>
  );
}
