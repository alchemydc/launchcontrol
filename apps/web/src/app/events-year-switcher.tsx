"use client";

import { YearSwitcher } from "@/components/year-switcher";

interface EventsYearSwitcherProps {
  years: number[];
  currentYear: number;
}

export function EventsYearSwitcher({ years, currentYear }: EventsYearSwitcherProps) {
  return (
    <YearSwitcher
      years={years}
      currentYear={currentYear}
      buildHref={(y) => `/?year=${y}`}
    />
  );
}
