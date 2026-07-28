"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EventsFilterLeagueOption = { slug: string; name: string };
export type EventsFilterSeasonOption = { slug: string; name: string };

/**
 * League x season filter for /admin/events (Task 17). Plain `<Select>`s that
 * navigate via `router.push` — the page is a server component, so a URL
 * change is what re-fetches and re-renders under the new scope.
 *
 * Picking a league always resets the season param: a season slug is only
 * meaningful within the league that owns it (`Season` is `@@unique([leagueId,
 * slug])`, not globally unique), so carrying a season selection across a
 * league switch could silently pin the URL to a season that doesn't belong
 * to the newly-selected league.
 */
export function EventsFilterBar({
  leagues,
  seasons,
  currentLeague,
  currentSeason,
}: {
  /** Administered leagues only (superuser -> all leagues) — see admin.ts. */
  leagues: EventsFilterLeagueOption[];
  /** Seasons of `currentLeague` only; empty when `currentLeague === "all"`. */
  seasons: EventsFilterSeasonOption[];
  /** "all" or a league slug. */
  currentLeague: string;
  /** "all" or a season slug (only meaningful when `currentLeague !== "all"`). */
  currentSeason: string;
}) {
  const router = useRouter();

  function goTo(league: string, season: string) {
    const qs = new URLSearchParams();
    if (league !== "all") qs.set("league", league);
    if (league !== "all" && season !== "all") qs.set("season", season);
    const query = qs.toString();
    router.push(query ? `/admin/events?${query}` : "/admin/events");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={currentLeague} onValueChange={(v) => v && goTo(v, "all")}>
        <SelectTrigger className="w-full sm:w-56 bg-background">
          <SelectValue placeholder="All leagues" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All leagues</SelectItem>
          {leagues.map((league) => (
            <SelectItem key={league.slug} value={league.slug}>
              {league.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentSeason}
        onValueChange={(v) => v && goTo(currentLeague, v)}
        disabled={currentLeague === "all" || seasons.length === 0}
      >
        <SelectTrigger className="w-full sm:w-56 bg-background">
          <SelectValue placeholder="All seasons" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All seasons</SelectItem>
          {seasons.map((season) => (
            <SelectItem key={season.slug} value={season.slug}>
              {season.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
