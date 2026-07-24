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
  /** e.g. "/l/rmsolo/leaderboard/s" — every option links to `${basePath}/${slug}`
   *  unless `buildHref` is given (Task 21: the Events tab targets
   *  `${leagueBasePath}?season=${slug}` instead of a path segment). */
  basePath: string;
  /** Slimmer trigger for the subnav bar. */
  compact?: boolean;
  /** Overrides the default `${basePath}/${slug}` destination — the league
   *  subnav passes this on the Events tab so switching seasons there stays
   *  on the league home with `?season=<slug>` rather than navigating to a
   *  leaderboard path. */
  buildHref?: (slug: string) => string;
}

/**
 * Season switcher for league-scoped routes (Task 5, extended Task 21) —
 * addresses seasons by slug and labels them by name, unlike the legacy
 * `SeasonSwitcher` (bare year, `/leaderboard/[year]`), since a league can
 * have more than one season per year (e.g. a Winter Series alongside the
 * main season). Tab-aware: on the leaderboard tab it navigates to a
 * season-scoped path; on the Events tab it navigates to `?season=<slug>` on
 * the league home (see `buildHref`).
 */
export function LeagueSeasonSwitcher({
  seasons,
  currentSlug,
  basePath,
  compact,
  buildHref,
}: LeagueSeasonSwitcherProps) {
  const router = useRouter();

  return (
    <Select
      value={currentSlug}
      onValueChange={(v) => {
        if (v) router.push(buildHref ? buildHref(v) : `${basePath}/${v}`);
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
