"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LeagueSeasonSwitcherProps {
  seasons: Array<{ slug: string; name: string }>;
  currentSlug: string;
  /** Destination for a chosen season slug. A function (not a fixed base path) so
   *  one switcher can drive both the season-addressed leaderboard
   *  (`/l/[slug]/leaderboard/s/[season]`) and the `?season=`-filtered events tab,
   *  depending on which tab the subnav is showing. */
  buildHref: (slug: string) => string;
  /** Slimmer trigger for the subnav bar. */
  compact?: boolean;
}

/**
 * Season switcher for league-scoped leaderboard routes (Task 5) — addresses
 * seasons by slug and labels them by name, unlike the legacy `SeasonSwitcher`
 * (bare year, `/leaderboard/[year]`), since a league can have more than one
 * season per year (e.g. a Winter Series alongside the main season).
 */
export function LeagueSeasonSwitcher({
  seasons,
  currentSlug,
  buildHref,
  compact,
}: LeagueSeasonSwitcherProps) {
  const router = useRouter();

  return (
    <Select
      value={currentSlug}
      onValueChange={(v) => {
        if (v) router.push(buildHref(v));
      }}
    >
      <SelectTrigger
        className={
          compact
            ? "h-8 w-auto max-w-48 bg-background text-sm"
            : "w-full sm:w-48 bg-background"
        }
      >
        {/* Explicit child: Base UI's Select.Value renders the raw value
            (the slug) when empty — we want the season's display name. */}
        <SelectValue>
          {seasons.find((s) => s.slug === currentSlug)?.name ?? currentSlug}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {seasons.map((s) => (
          <SelectItem key={s.slug} value={s.slug}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
