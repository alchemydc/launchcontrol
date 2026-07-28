"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ScoringPolicy } from "@/lib/scoring-policy";
import { PresetDialog } from "./preset-dialog";

export type PresetRow = {
  id: number;
  name: string;
  /** null only if the stored policy JSON couldn't be parsed — shouldn't happen for rows
   *  written through createScoringSystem/updateScoringSystem, but defended against here
   *  since this reads raw data straight off the table. */
  policy: ScoringPolicy | null;
  /** Raw COMPLETE code->factor JSON string — edited via PaxTableEditor, not parsed for display here. */
  paxTable: string;
  /** Seasons currently pointing at this ruleset (live reference) — drives the
   *  "Used by N seasons" column and the edit dialog's affected-season warning
   *  and post-save Re-apply prompt. */
  seasons: { name: string; slug: string }[];
};

const DROP_TIMING_LABEL: Record<ScoringPolicy["dropTiming"], string> = {
  fixed: "Fixed",
  proportional: "Proportional",
};

export function PresetsTable({ leagueSlug, rows }: { leagueSlug: string; rows: PresetRow[] }) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<PresetRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PresetDialog mode="create" leagueSlug={leagueSlug} onCreated={() => router.refresh()} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Drops</TableHead>
            <TableHead>Drop timing</TableHead>
            <TableHead>PAX section</TableHead>
            <TableHead>Cone penalty</TableHead>
            <TableHead>Used by</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              {row.policy ? (
                <>
                  <TableCell>{row.policy.dropCount}</TableCell>
                  <TableCell>{DROP_TIMING_LABEL[row.policy.dropTiming]}</TableCell>
                  <TableCell>
                    <Badge variant={row.policy.paxSection ? "default" : "outline"}>
                      {row.policy.paxSection ? "On" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.policy.conePenaltyMs} ms</TableCell>
                </>
              ) : (
                <TableCell colSpan={4} className="text-destructive">
                  Stored policy could not be parsed — edit to fix.
                </TableCell>
              )}
              <TableCell
                title={row.seasons.length > 0 ? row.seasons.map((s) => s.name).join(", ") : undefined}
              >
                {row.seasons.length === 0
                  ? "No seasons"
                  : `${row.seasons.length} season${row.seasons.length === 1 ? "" : "s"}`}
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => setEditingRow(row)}>
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No scoring rulesets yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editingRow && (
        <PresetDialog
          mode="edit"
          leagueSlug={leagueSlug}
          preset={editingRow}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
