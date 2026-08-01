import Link from "next/link";
import { PAX_VIEW, RAW_VIEW } from "@/lib/leaderboard";

/**
 * Link pills for an event's views: Overview, the unfiltered all-entries list,
 * optional PAX standings, and one per class. Server component — class
 * selection is a route, not client state, so each target ships only its own
 * class's rows (and ISR-cached targets prefetch, keeping switches instant).
 *
 * The all-entries pill reads "All Raw" only when a PAX pill sits beside it —
 * the word exists to distinguish the two. With PAX standings off there is
 * nothing to distinguish from, so it is plain "All", matching the labelling of
 * the client-side filter chip this nav replaced in #99.
 */
export function EventClassNav({
  slug,
  classCodes,
  paxAvailable,
  active,
  basePath = "",
}: {
  slug: string;
  classCodes: string[];
  paxAvailable: boolean;
  /** Active class code, `"pax"` / `"raw"` for the virtual views, or undefined on the overview. */
  active?: string;
  basePath?: string;
}) {
  const eventHref = `${basePath}/events/${slug}`;
  const inactiveCls =
    "inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none";
  const activeCls =
    "inline-flex items-center rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary transition-colors";

  const pill = (href: string, isActive: boolean, label: string) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={isActive ? activeCls : inactiveCls}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Event views" className="mb-6">
      <ul className="flex flex-wrap gap-1.5">
        <li>{pill(eventHref, active == null, "Overview")}</li>
        <li>
          {pill(
            `${eventHref}/${RAW_VIEW}`,
            active === RAW_VIEW,
            paxAvailable ? "All Raw" : "All",
          )}
        </li>
        {paxAvailable && (
          <li>{pill(`${eventHref}/${PAX_VIEW}`, active === PAX_VIEW, "All PAX")}</li>
        )}
        {classCodes.map((code) => (
          <li key={code}>
            {pill(
              `${eventHref}/${encodeURIComponent(code)}`,
              active === code,
              code,
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
