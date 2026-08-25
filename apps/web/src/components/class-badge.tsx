"use client";

/**
 * The one class-code badge, shared by every results table.
 *
 * Three tables used to carry their own copy of this markup — the event
 * leaderboard, the combined-event table, and the driver event history — which
 * meant a class code rendered slightly differently depending on where you were
 * looking at it. It's one component now, and it's also the single place the
 * classing hover card is wired in.
 *
 * `vehicles` is the pre-formatted list of cars in this class for the season
 * being viewed (see `classVehicleLines` in lib/classing.ts). It arrives from the
 * server page as one map per render, so there is no per-row work here and no
 * client fetch. When it is absent — a league with no classing model, or a class
 * with no entry in it, such as PCA's time-only `TO` — the badge renders exactly
 * as it always did, plain and non-interactive.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { ClassingHints } from "@/lib/classing";

export type { ClassingHints };

/** Vehicle lines shown before the panel switches to "…and N more". */
const VISIBLE_VEHICLES = 8;

export type ClassBadgeProps = {
  classCode: string;
  /** Shown as "PAX <code>" beside the badge when it differs from the entered class. */
  paxClassCode?: string;
  /** Omit for no hover card — an unclassed league, or a page that has no season. */
  classing?: ClassingHints;
  /** Tighter type for the dense combined-event table. */
  compact?: boolean;
};

export function ClassBadge({
  classCode,
  paxClassCode,
  classing,
  compact = false,
}: ClassBadgeProps) {
  const vehicles = classing?.vehicles[classCode];
  const seasonLabel = classing?.seasonLabel;
  const basePath = classing?.basePath ?? "";
  // Address the guide at the SAME season these lines describe. The guide
  // defaults to the league's active season, so on a historical event the link
  // would otherwise open rules that disagree with the card above it.
  const guideHref = classing
    ? `${basePath}/classing?season=${encodeURIComponent(classing.seasonSlug)}#${encodeURIComponent(classCode)}`
    : "";

  const badge = (
    <Badge variant="outline" className={compact ? "text-[10px]" : undefined}>
      {classCode}
    </Badge>
  );

  const paxNote =
    paxClassCode && paxClassCode !== classCode ? (
      <span className="text-muted-foreground text-xs">PAX {paxClassCode}</span>
    ) : null;

  if (!vehicles || vehicles.length === 0) {
    return paxNote ? (
      <div className="flex items-center gap-1.5">
        {badge}
        {paxNote}
      </div>
    ) : (
      badge
    );
  }

  const shown = vehicles.slice(0, VISIBLE_VEHICLES);
  const hidden = vehicles.length - shown.length;

  return (
    <div className="flex items-center gap-1.5">
      <HoverCard>
        {/* A button, not the bare badge: the hover card has to be reachable by
            keyboard and by tap, not only by pointer hover. */}
        <HoverCardTrigger
          render={
            <button
              type="button"
              aria-label={`What runs in class ${classCode}`}
              className="cursor-help rounded-4xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          }
        >
          {badge}
        </HoverCardTrigger>
        <HoverCardContent>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">Class {classCode}</span>
            {seasonLabel && (
              <span className="text-muted-foreground text-xs">{seasonLabel}</span>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {shown.map((line) => (
              <li key={line}>• {line}</li>
            ))}
            {hidden > 0 && <li className="italic">…and {hidden} more</li>}
          </ul>
          <Link
            href={guideHref}
            className="mt-2.5 inline-block text-xs text-primary hover:underline"
          >
            Full classing guide →
          </Link>
        </HoverCardContent>
      </HoverCard>
      {paxNote}
    </div>
  );
}
