import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeletons for the results routes' `loading.tsx` boundaries.
 *
 * These mirror the real pages' outer shape — same `<main>` container, same
 * header block, same table rhythm — so the skeleton→content swap doesn't shift
 * layout. They are deliberately approximate inside that frame: the point is to
 * show the page's structure arriving immediately, not to mimic every element.
 *
 * `role="status"` + `aria-label` announces one "Loading" to assistive tech; the
 * individual blocks are `aria-hidden` (see `ui/skeleton.tsx`) so a screen
 * reader doesn't walk a tree of empty boxes.
 */

function TableRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function HeaderBlock() {
  return (
    <div className="mb-6 sm:mb-8">
      <Skeleton className="h-3 w-32 mb-3" />
      <div className="flex items-start gap-4">
        <div className="h-8 w-0.5 bg-primary/30 rounded-full shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
      </div>
    </div>
  );
}

/** Season leaderboards and event results — header, class pills, standings table. */
export function ResultsSkeleton() {
  return (
    <main
      role="status"
      aria-label="Loading results"
      className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10"
    >
      <HeaderBlock />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20" />
        ))}
      </div>
      <TableRows rows={12} />
    </main>
  );
}

/** Driver detail — header, stat tiles, progression chart, event history. */
export function DriverSkeleton() {
  return (
    <main
      role="status"
      aria-label="Loading driver"
      className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10"
    >
      <HeaderBlock />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="mb-6 h-64 w-full" />
      <TableRows rows={8} />
    </main>
  );
}
