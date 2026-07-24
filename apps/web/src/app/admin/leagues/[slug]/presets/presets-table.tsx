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
};

const DROPS_LABEL: Record<ScoringPolicy["drops"], string> = {
  fixed: "Fixed",
  proportional: "Proportional",
};

const CLASS_METRIC_LABEL: Record<ScoringPolicy["classMetric"], string> = {
  raw: "Raw",
  pax: "PAX",
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
            <TableHead>Class metric</TableHead>
            <TableHead>PAX section</TableHead>
            <TableHead>Cone penalty</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              {row.policy ? (
                <>
                  <TableCell>{DROPS_LABEL[row.policy.drops]}</TableCell>
                  <TableCell>{CLASS_METRIC_LABEL[row.policy.classMetric]}</TableCell>
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
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => setEditingRow(row)}>
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
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
