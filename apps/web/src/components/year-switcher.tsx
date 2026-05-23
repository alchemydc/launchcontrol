"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface YearSwitcherProps {
  years: number[];
  currentYear: number;
  buildHref: (year: number) => string;
  label?: (year: number) => string;
}

export function YearSwitcher({
  years,
  currentYear,
  buildHref,
  label = (y) => `${y} Season`,
}: YearSwitcherProps) {
  const router = useRouter();

  return (
    <Select
      value={String(currentYear)}
      onValueChange={(v) => {
        if (v) router.push(buildHref(Number(v)));
      }}
    >
      <SelectTrigger className="w-full sm:w-36 bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {label(year)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
