"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AuditFilterLeagueOption = { slug: string; name: string };

/**
 * League filter for /admin/audit (Task 17). Plain `<Select>` that navigates
 * via `router.push` — the page is a server component that re-fetches and
 * re-filters under the new `?league=` param.
 */
export function AuditFilterBar({
  leagues,
  current,
}: {
  /** Administered leagues only (superuser -> all leagues) — see admin.ts. */
  leagues: AuditFilterLeagueOption[];
  /** "all" or a league slug. */
  current: string;
}) {
  const router = useRouter();

  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (!v) return;
        router.push(v === "all" ? "/admin/audit" : `/admin/audit?league=${v}`);
      }}
    >
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
  );
}
