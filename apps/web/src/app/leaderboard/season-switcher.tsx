"use client";

import { YearSwitcher } from "@/components/year-switcher";

interface SeasonSwitcherProps {
  years: number[];
  currentYear: number;
}

export function SeasonSwitcher({ years, currentYear }: SeasonSwitcherProps) {
  return (
    <YearSwitcher
      years={years}
      currentYear={currentYear}
      buildHref={(y) => `/leaderboard/${y}`}
    />
  );
}
