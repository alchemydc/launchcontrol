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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SeasonDialog, type PresetOption } from "./season-dialog";

export type SeasonRow = {
  id: number;
  name: string;
  slug: string;
  year: number;
  plannedEvents: number;
  status: "active" | "completed";
  /** Raw JSON string (code -> factor) — edited as a textarea, not parsed for display here. */
  paxTable: string;
  events: number;
};

export function SeasonsTable({
  leagueSlug,
  rows,
  presets,
}: {
  leagueSlug: string;
  rows: SeasonRow[];
  presets: PresetOption[];
}) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<SeasonRow | null>(null);
  const [reapplyRow, setReapplyRow] = useState<SeasonRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <SeasonDialog
          mode="create"
          leagueSlug={leagueSlug}
          presets={presets}
          onCreated={() => router.refresh()}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Planned events</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.slug}
              </TableCell>
              <TableCell>{row.year}</TableCell>
              <TableCell>{row.plannedEvents}</TableCell>
              <TableCell>{row.events}</TableCell>
              <TableCell>
                <Badge variant={row.status === "active" ? "default" : "secondary"}>
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingRow(row)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setReapplyRow(row)}>
                    Re-apply PAX
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No seasons yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editingRow && (
        <SeasonDialog
          mode="edit"
          leagueSlug={leagueSlug}
          season={editingRow}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null);
            router.refresh();
          }}
        />
      )}

      {reapplyRow && (
        <ReapplyPaxDialog
          leagueSlug={leagueSlug}
          season={reapplyRow}
          onClose={() => setReapplyRow(null)}
        />
      )}
    </div>
  );
}

type ReapplyResult = { updated: number; codes: string[] };

function ReapplyPaxDialog({
  leagueSlug,
  season,
  onClose,
}: {
  leagueSlug: string;
  season: SeasonRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReapplyResult | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/leagues/${leagueSlug}/seasons/${season.slug}/pax-reapply`,
        { method: "POST" },
      );
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setResult(json.reapplied as ReapplyResult);
        setPending(false);
        router.refresh();
      } else {
        setError((json["error"] as string) ?? "Re-apply failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>PAX factors re-applied</DialogTitle>
              <DialogDescription>
                {result.updated === 0
                  ? "No entries updated — either the PAX table is empty, or no entry in this season's events belongs to one of the classes it covers."
                  : `Updated ${result.updated} ${result.updated === 1 ? "entry" : "entries"} across ${result.codes.length} ${result.codes.length === 1 ? "class" : "classes"}: ${result.codes.join(", ")}.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Re-apply PAX factors for {season.name}?</DialogTitle>
              <DialogDescription>
                This rewrites applied factors for this season&apos;s entries whose class appears
                in the table. Entries whose class code isn&apos;t covered by the table are left
                untouched. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={pending}>
                {pending ? "Re-applying..." : "Re-apply"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
