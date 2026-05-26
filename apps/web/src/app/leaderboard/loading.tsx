export default function LeaderboardLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <div className="animate-pulse rounded bg-muted h-3 w-32 mb-3" />
        <div className="flex items-start gap-4 min-w-0">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="min-w-0 flex-1">
            <div className="animate-pulse rounded bg-muted h-8 w-72 mb-3" />
            <div className="animate-pulse rounded bg-muted h-3 w-full max-w-xl mb-1.5" />
            <div className="animate-pulse rounded bg-muted h-3 w-3/4 max-w-lg" />
          </div>
        </div>
      </header>

      {/* Class jump bar */}
      <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 mb-6 overflow-x-auto">
        <div className="flex gap-1.5 w-max">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-full bg-muted h-6 w-12"
            />
          ))}
        </div>
      </div>

      {/* Class section cards */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm mb-6"
        >
          {/* Section header */}
          <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-3 border-b border-border/60">
            <div className="flex items-center gap-2">
              <div className="animate-pulse rounded bg-muted h-4 w-16" />
              <div className="animate-pulse rounded-full bg-muted h-4 w-14" />
            </div>
            <div className="animate-pulse rounded bg-muted h-3 w-40 hidden sm:block" />
          </div>

          {/* Mobile: card list */}
          <ul className="md:hidden divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, j) => (
              <li key={j} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="animate-pulse rounded-full bg-muted h-7 w-7 shrink-0" />
                  <div className="animate-pulse rounded bg-muted h-4 flex-1 max-w-[180px]" />
                  <div className="text-right shrink-0">
                    <div className="animate-pulse rounded bg-muted h-5 w-10 mb-1 ml-auto" />
                    <div className="animate-pulse rounded bg-muted h-2.5 w-8 ml-auto" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from({ length: 5 }).map((_, k) => (
                    <div key={k} className="animate-pulse rounded-md bg-muted h-9 w-12" />
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <div className="flex items-center gap-3 bg-muted/20 px-3 h-9 border-b border-border/60">
              <div className="w-12">
                <div className="animate-pulse rounded bg-muted h-2.5 w-4" />
              </div>
              <div className="flex-1">
                <div className="animate-pulse rounded bg-muted h-2.5 w-16" />
              </div>
              <div className="w-20 text-right">
                <div className="animate-pulse rounded bg-muted h-2.5 w-12 ml-auto" />
              </div>
              <div className="flex-1">
                <div className="animate-pulse rounded bg-muted h-2.5 w-24" />
              </div>
            </div>
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="flex items-center gap-3 px-3 py-3 border-b border-border/40 last:border-b-0"
              >
                <div className="w-12">
                  <div className="animate-pulse rounded-full bg-muted h-7 w-7" />
                </div>
                <div className="flex-1">
                  <div className="animate-pulse rounded bg-muted h-4 w-40 max-w-full" />
                </div>
                <div className="w-20">
                  <div className="animate-pulse rounded bg-muted h-4 w-10 ml-auto" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 5 }).map((_, k) => (
                      <div key={k} className="animate-pulse rounded-md bg-muted h-9 w-12" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
