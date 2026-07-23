"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/**
 * League × time-scope filter bar for /drivers/[id] (Task 6). Server-side
 * filtering: this component only ever builds a new URL and navigates —
 * `page.tsx` re-fetches and re-renders with the new query params. Picking a
 * league chip resets the time scope to "All time" (a season/date-range
 * pinned to one league's addressing doesn't carry meaning across leagues);
 * picking a season drops the league param instead, since a season already
 * implies its own league unambiguously and the two must never disagree.
 *
 * "Season" and "Custom range" reveal a sub-control locally (via `uiScope`)
 * without navigating — only an actual season pick or the Apply button
 * triggers a page navigation, so switching the Select doesn't round-trip
 * the server with an incomplete selection.
 */
export function DriverFilterBar({ driverId, leagues, seasons, current }: DriverFilterBarProps) {
  const router = useRouter();
  const basePath = `/drivers/${driverId}`;

  const [uiScope, setUiScope] = useState<TimeScope>(current.timeScope);
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
    setUiScope("all");
    goTo({ league: slug });
  }

  function onTimeScopeChange(scope: TimeScope) {
    setUiScope(scope);
    if (scope === "all") goTo({ league: current.league });
    // "season"/"range" just reveal their sub-control below; navigation
    // happens once the user actually picks a season or applies a range.
  }

  function selectSeason(seasonId: string | null) {
    if (seasonId) goTo({ season: seasonId });
  }

  function applyRange() {
    goTo({ league: current.league, from: pendingFrom, to: pendingTo });
  }

  const seasonsInScope =
    current.league === "all" ? seasons : seasons.filter((s) => s.leagueSlug === current.league);

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      {leagues.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            League
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={current.league === "all" ? "default" : "outline"}
              onClick={() => selectLeague("all")}
            >
              All leagues
            </Button>
            {leagues.map((l) => (
              <Button
                key={l.slug}
                size="sm"
                variant={current.league === l.slug ? "default" : "outline"}
                onClick={() => selectLeague(l.slug)}
              >
                {l.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Time
        </span>
        <Select value={uiScope} onValueChange={(v) => onTimeScopeChange(v as TimeScope)}>
          <SelectTrigger className="w-full sm:w-40 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="season">Season</SelectItem>
            <SelectItem value="range">Custom range</SelectItem>
          </SelectContent>
        </Select>

        {uiScope === "season" && (
          <Select
            value={current.seasonId != null ? String(current.seasonId) : undefined}
            onValueChange={selectSeason}
          >
            <SelectTrigger className="w-full sm:w-56 bg-background">
              <SelectValue placeholder="Choose a season…" />
            </SelectTrigger>
            <SelectContent>
              {seasonsInScope.map((s) => (
                <SelectItem key={s.seasonId} value={String(s.seasonId)}>
                  {current.league === "all" ? `${s.leagueName} · ${s.seasonName}` : s.seasonName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {uiScope === "range" && (
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
    </div>
  );
}
