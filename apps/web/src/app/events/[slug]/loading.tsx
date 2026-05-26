export default function EventLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        {/* Back button + date pill row */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="animate-pulse rounded bg-muted h-7 w-20" />
          <div className="animate-pulse rounded bg-muted h-3 w-32" />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Title with accent bar */}
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
            <div className="animate-pulse rounded bg-muted h-8 w-80" />
          </div>

          {/* Photos link + entries badge */}
          <div className="flex items-center gap-3 shrink-0 sm:ml-4">
            <div className="animate-pulse rounded bg-muted h-4 w-16" />
            <div className="animate-pulse rounded-full bg-muted h-5 w-20" />
          </div>
        </div>
      </header>

      {/* Table placeholder */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        {/* Filter header strip */}
        <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3 border-b border-border/60 md:flex-row md:items-center">
          <div className="animate-pulse rounded bg-muted h-3 w-20 shrink-0" />
          <div className="-mx-1 px-1 overflow-x-auto flex-1">
            <div className="flex gap-1.5 w-max">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-full bg-muted h-6 w-12" />
              ))}
            </div>
          </div>
          <div className="animate-pulse rounded-full bg-muted h-6 w-20 shrink-0 self-start md:self-auto md:ml-auto" />
        </div>

        {/* Mobile: card list */}
        <ul className="md:hidden divide-y divide-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="animate-pulse rounded-full bg-muted h-7 w-7 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="animate-pulse rounded bg-muted h-4 w-40 max-w-full mb-1.5" />
                  <div className="animate-pulse rounded bg-muted h-3 w-32 max-w-full mb-2" />
                  <div className="flex items-center gap-1.5">
                    <div className="animate-pulse rounded bg-muted h-5 w-12" />
                    <div className="animate-pulse rounded bg-muted h-3 w-16" />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="animate-pulse rounded bg-muted h-5 w-16 mb-1 ml-auto" />
                  <div className="animate-pulse rounded bg-muted h-2.5 w-12 ml-auto" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="animate-pulse rounded bg-muted h-5 w-12" />
                ))}
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: table */}
        <div className="hidden md:block">
          <div className="flex items-center gap-3 bg-muted/20 px-3 h-11 border-b border-border/60">
            <div className="w-12">
              <div className="animate-pulse rounded bg-muted h-2.5 w-4" />
            </div>
            <div className="w-10">
              <div className="animate-pulse rounded bg-muted h-2.5 w-4" />
            </div>
            <div className="flex-1">
              <div className="animate-pulse rounded bg-muted h-2.5 w-16" />
            </div>
            <div className="w-24">
              <div className="animate-pulse rounded bg-muted h-2.5 w-12" />
            </div>
            <div className="w-20 text-right">
              <div className="animate-pulse rounded bg-muted h-2.5 w-16 ml-auto" />
            </div>
            <div className="w-20 text-right">
              <div className="animate-pulse rounded bg-muted h-2.5 w-16 ml-auto" />
            </div>
            <div className="flex-1">
              <div className="animate-pulse rounded bg-muted h-2.5 w-12" />
            </div>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-3 py-3 border-b border-border/40 last:border-b-0"
            >
              <div className="w-12">
                <div className="animate-pulse rounded-full bg-muted h-7 w-7" />
              </div>
              <div className="w-10">
                <div className="animate-pulse rounded bg-muted h-4 w-6" />
              </div>
              <div className="flex-1">
                <div className="animate-pulse rounded bg-muted h-4 w-40 max-w-full mb-1" />
                <div className="animate-pulse rounded bg-muted h-3 w-28 max-w-full" />
              </div>
              <div className="w-24">
                <div className="animate-pulse rounded bg-muted h-5 w-12" />
              </div>
              <div className="w-20">
                <div className="animate-pulse rounded bg-muted h-4 w-14 ml-auto" />
              </div>
              <div className="w-20">
                <div className="animate-pulse rounded bg-muted h-4 w-14 ml-auto" />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="animate-pulse rounded bg-muted h-5 w-12" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
