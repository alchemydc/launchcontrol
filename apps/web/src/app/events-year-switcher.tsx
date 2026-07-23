"use client";

import { YearSwitcher } from "@/components/year-switcher";

interface EventsYearSwitcherProps {
  years: number[];
  currentYear: number;
  /** "" for the legacy home page (byte-identical to pre-Task-5 hrefs),
   *  "/l/[slug]" for league-scoped home pages. */
  basePath?: string;
}

export function EventsYearSwitcher({
  years,
  currentYear,
  basePath = "",
}: EventsYearSwitcherProps) {
  return (
    <YearSwitcher
      years={years}
      currentYear={currentYear}
      buildHref={(y) => `${basePath || "/"}?year=${y}`}
    />
  );
}
