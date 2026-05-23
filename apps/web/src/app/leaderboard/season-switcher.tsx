"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SeasonSwitcherProps {
  years: number[];
  currentYear: number;
}

export function SeasonSwitcher({ years, currentYear }: SeasonSwitcherProps) {
  const router = useRouter();

  return (
    <Select
      value={String(currentYear)}
      onValueChange={(v) => {
        if (v) router.push(`/leaderboard/${v}`);
      }}
    >
      <SelectTrigger className="w-full sm:w-36 bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year} Season
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
