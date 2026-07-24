import Link from "next/link";

/**
 * Link pills for an event's views: Overview, optional PAX standings, and one
 * per class. Server component — class selection is a route, not client state,
 * so each target ships only its own class's rows (and ISR-cached targets
 * prefetch, keeping switches instant).
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
  /** Active class code, `"pax"` for the PAX view, or undefined on the overview. */
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
        {paxAvailable && (
          <li>{pill(`${eventHref}/pax`, active === "pax", "All PAX")}</li>
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
