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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EventRow } from "./events-table";

type UpdateResult = { ok: true } | { ok: false; error: string };

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export function EditEventDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: EventRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [date, setDate] = useState(toDateInputValue(row.date));
  const [location, setLocation] = useState(row.location ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/events/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          date,
          location: location.trim() ? location.trim() : null,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        onSuccess();
      } else {
        setResult({ ok: false, error: (json["error"] as string) ?? "Update failed" });
        setPending(false);
      }
    } catch {
      setResult({ ok: false, error: "Network error — could not reach the server" });
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
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
          <DialogDescription>
            Changing name or date regenerates the event URL slug.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-name">Name</Label>
            <Input
              id="event-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-date">Date</Label>
            <Input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          {result && !result.ok && <p className="text-sm text-destructive">{result.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
