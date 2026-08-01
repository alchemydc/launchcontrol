import { cn } from "@/lib/utils"

/**
 * Placeholder block for `loading.tsx` route skeletons. Purely presentational —
 * `aria-hidden` plus a `role="status"` wrapper at the skeleton root keeps
 * screen readers from announcing a tree of meaningless boxes; the wrapper
 * announces "Loading …" once instead.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
