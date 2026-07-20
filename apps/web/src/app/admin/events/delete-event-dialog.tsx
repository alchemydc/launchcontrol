"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EventRow } from "./events-table";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

type DeleteResponse = {
  deleted: { id: number; slug: string; name: string };
  counts: { entries: number; runs: number; videos: number };
  orphanDriversDeleted: number;
};

export function DeleteEventDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: EventRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<DeleteResponse | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${row.id}`, { method: "DELETE" });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setDeleted(json as unknown as DeleteResponse);
        setPending(false);
        onDeleted();
      } else {
        setError((json["error"] as string) ?? "Delete failed");
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
        {deleted ? (
          <>
            <DialogHeader>
              <DialogTitle>Event deleted</DialogTitle>
              <DialogDescription>
                Deleted <strong className="text-foreground">{deleted.deleted.name}</strong> —{" "}
                {plural(deleted.counts.entries, "entry", "entries")},{" "}
                {plural(deleted.counts.runs, "run")}, and {plural(deleted.counts.videos, "video")}{" "}
                removed. {plural(deleted.orphanDriversDeleted, "orphaned driver")} swept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete event</DialogTitle>
              <DialogDescription>
                This permanently deletes <strong className="text-foreground">{row.name}</strong>{" "}
                ({formatDate(row.date)}) — {plural(row.entries, "entry", "entries")},{" "}
                {plural(row.runs, "run")}, and {plural(row.videos, "video")}. Drivers with no other
                entries or videos will also be removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={pending}>
                {pending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
