"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DriverFilterLeagueOption = {
  slug: string;
  name: string;
};

export type DriverFilterSeasonOption = {
  seasonId: number;
  seasonName: string;
  year: number;
  leagueSlug: string;
  leagueName: string;
};

type TimeScope = "all" | "season" | "range";

export interface DriverFilterBarProps {
  driverId: number;
  /** Every league this driver has entries in. Chips only render when there's
   *  more than one — a single-league driver has nothing to choose between. */
  leagues: DriverFilterLeagueOption[];
  /** Every season the driver has entries in, across every league. */
  seasons: DriverFilterSeasonOption[];
  /** Current effective selection, resolved server-side from the URL (or
   *  legacy defaults when no query params are present). */
  current: {
    league: "all" | string; // "all" or a league slug
    timeScope: TimeScope;
    seasonId?: number;
    from?: string; // yyyy-mm-dd
    to?: string; // yyyy-mm-dd
  };
}

// Same pill styling as `ClassChip` in events/[slug]/leaderboard-table.tsx --
// kept as a local copy rather than a shared import since that component
// isn't exported and extracting it is a cross-file change out of scope here.
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "inline-flex items-center rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary transition-colors"
          : "inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none"
      }
    >
      {children}
    </button>
  );
}

/**
 * League × time-scope filter bar for /drivers/[id] (Task 6). Server-side
 * filtering: this component only ever builds a new URL and navigates —
 * `page.tsx` re-fetches and re-renders with the new query params.
 *
 * Time scope is chip shortcuts, not a slider or dropdown (product
 * directive): "All time" + one chip per season the driver has entries in
 * (label = season name) + a "Custom" chip that reveals a native
 * `<input type="date">` from/to range inline. Picking a league chip resets
 * time scope to "All time" (a season/date-range pinned to one league's
 * addressing doesn't carry meaning across leagues); picking a season chip
 * drops the league param instead, since a season already implies its own
 * league unambiguously and the two must never disagree.
 *
 * "Custom" only reveals the date inputs locally (`showCustom`) — it doesn't
 * navigate until Apply, so opening the panel never round-trips the server
 * with an incomplete range.
 */
export function DriverFilterBar({ driverId, leagues, seasons, current }: DriverFilterBarProps) {
  const router = useRouter();
  const basePath = `/drivers/${driverId}`;

  const [showCustom, setShowCustom] = useState(current.timeScope === "range");
  const [pendingFrom, setPendingFrom] = useState(current.from ?? "");
  const [pendingTo, setPendingTo] = useState(current.to ?? "");

  function goTo(params: Record<string, string | undefined>) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    const query = qs.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  function selectLeague(slug: "all" | string) {
    setShowCustom(false);
    goTo({ league: slug });
  }

  function selectAllTime() {
    setShowCustom(false);
    goTo({ league: current.league });
  }

  function selectSeason(seasonId: number) {
    setShowCustom(false);
    goTo({ season: String(seasonId) });
  }

  function applyRange() {
    goTo({ league: current.league, from: pendingFrom, to: pendingTo });
  }

  const seasonsInScope =
    current.league === "all" ? seasons : seasons.filter((s) => s.leagueSlug === current.league);
  const isCustomActive = showCustom || current.timeScope === "range";

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      {leagues.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground shrink-0">
            League
          </span>
          <nav aria-label="Filter by league" className="-mx-1 px-1 overflow-x-auto">
            <ul className="flex flex-wrap gap-1.5">
              <li>
                <Chip active={current.league === "all"} onClick={() => selectLeague("all")}>
                  All leagues
                </Chip>
              </li>
              {leagues.map((l) => (
                <li key={l.slug}>
                  <Chip active={current.league === l.slug} onClick={() => selectLeague(l.slug)}>
                    {l.name}
                  </Chip>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground shrink-0">
          Time
        </span>
        <nav aria-label="Filter by time range" className="-mx-1 px-1 overflow-x-auto">
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <Chip active={!isCustomActive && current.timeScope === "all"} onClick={selectAllTime}>
                All time
              </Chip>
            </li>
            {seasonsInScope.map((s) => (
              <li key={s.seasonId}>
                <Chip
                  active={
                    !isCustomActive &&
                    current.timeScope === "season" &&
                    current.seasonId === s.seasonId
                  }
                  onClick={() => selectSeason(s.seasonId)}
                >
                  {current.league === "all" ? `${s.leagueName} · ${s.seasonName}` : s.seasonName}
                </Chip>
              </li>
            ))}
            <li>
              <Chip active={isCustomActive} onClick={() => setShowCustom(true)}>
                Custom
              </Chip>
            </li>
          </ul>
        </nav>
      </div>

      {isCustomActive && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="sr-only" htmlFor="driver-filter-from">
            From
          </Label>
          <Input
            id="driver-filter-from"
            type="date"
            className="w-36"
            value={pendingFrom}
            onChange={(e) => setPendingFrom(e.target.value)}
          />
          <span className="text-muted-foreground text-xs">to</span>
          <Label className="sr-only" htmlFor="driver-filter-to">
            To
          </Label>
          <Input
            id="driver-filter-to"
            type="date"
            className="w-36"
            value={pendingTo}
            onChange={(e) => setPendingTo(e.target.value)}
          />
          <Button size="sm" onClick={applyRange}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
