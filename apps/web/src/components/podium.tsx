export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function podiumClasses(rank: number): string {
  switch (rank) {
    case 1:
      return "bg-amber-100 text-amber-900 ring-1 ring-amber-300/70 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/30";
    case 2:
      return "bg-zinc-200 text-zinc-800 ring-1 ring-zinc-300/70 dark:bg-zinc-400/20 dark:text-zinc-100 dark:ring-zinc-300/30";
    case 3:
      return "bg-orange-200 text-orange-900 ring-1 ring-orange-300/70 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-400/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function RankPill({ rank }: { rank: number | undefined }) {
  if (rank == null) return null;
  return (
    <div
      aria-label={`${ordinal(rank)} place`}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums ${podiumClasses(rank)}`}
    >
      {rank}
    </div>
  );
}
