"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SeasonRow } from "./seasons-table";

export type PresetOption = { id: number; name: string };

export function rulesetSelectItems(presets: PresetOption[]) {
  return presets.map((preset) => ({ value: String(preset.id), label: preset.name }));
}

type SeasonStatus = "active" | "completed";

const STATUS_OPTIONS: { value: SeasonStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

type CreateProps = {
  mode: "create";
  leagueSlug: string;
  presets: PresetOption[];
  onCreated: () => void;
};

type EditProps = {
  mode: "edit";
  leagueSlug: string;
  season: SeasonRow;
  presets: PresetOption[];
  onClose: () => void;
  onSaved: () => void;
};

export function SeasonDialog(props: CreateProps | EditProps) {
  if (props.mode === "create") return <CreateSeasonDialog {...props} />;
  return <EditSeasonDialog {...props} />;
}

function CreateSeasonDialog({ leagueSlug, presets, onCreated }: CreateProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [slug, setSlug] = useState("");
  const [plannedEvents, setPlannedEvents] = useState("0");
  const [minimumEvents, setMinimumEvents] = useState("4");
  // Required — no "league default" sentinel: the season must name a ruleset
  // explicitly (Task R3). Defaults to the first available ruleset.
  const [presetName, setPresetName] = useState<string>(presets[0]?.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetNameItems = useMemo(
    () => presets.map((preset) => ({ value: preset.name, label: preset.name })),
    [presets],
  );

  function reset() {
    setName("");
    setYear(String(new Date().getFullYear()));
    setSlug("");
    setPlannedEvents("0");
    setMinimumEvents("4");
    setPresetName(presets[0]?.name ?? "");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const yearNum = Number(year);
    const plannedNum = Number(plannedEvents);
    const minimumNum = Number(minimumEvents);
    if (!Number.isInteger(yearNum)) {
      setError("Year must be an integer");
      setPending(false);
      return;
    }
    if (!Number.isInteger(plannedNum) || plannedNum < 0) {
      setError("Planned events must be a non-negative integer");
      setPending(false);
      return;
    }
    if (!Number.isInteger(minimumNum) || minimumNum < 0) {
      setError("Minimum events must be a non-negative integer");
      setPending(false);
      return;
    }
    if (!presetName) {
      setError("Pick a ruleset — create one on the Rulesets page first");
      setPending(false);
      return;
    }

    const body: Record<string, unknown> = {
      name,
      year: yearNum,
      plannedEvents: plannedNum,
      minimumEvents: minimumNum,
      presetName,
    };
    if (slug.trim()) body.slug = slug.trim();

    try {
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        setOpen(false);
        reset();
        onCreated();
      } else {
        setError((json["error"] as string) ?? "Create failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button>Create season</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create season</DialogTitle>
          <DialogDescription>
            The season follows this ruleset — editing the ruleset changes this season&apos;s
            standings.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-name">Name</Label>
            <Input
              id="season-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2027 Season"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-year">Year</Label>
            <Input
              id="season-year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-slug">Slug (optional)</Label>
            <Input
              id="season-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="Defaults to a slugified name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-planned">Planned events</Label>
            <Input
              id="season-planned"
              type="number"
              min={0}
              value={plannedEvents}
              onChange={(e) => setPlannedEvents(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-minimum">Minimum events to qualify</Label>
            <Input
              id="season-minimum"
              type="number"
              min={0}
              value={minimumEvents}
              onChange={(e) => setMinimumEvents(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="season-preset">Ruleset</Label>
            <Select
              items={presetNameItems}
              value={presetName}
              onValueChange={(v) => setPresetName(v ?? presetName)}
            >
              <SelectTrigger id="season-preset" className="w-full">
                <SelectValue placeholder="Select a ruleset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSeasonDialog({ leagueSlug, season, presets, onClose, onSaved }: EditProps) {
  const [name, setName] = useState(season.name);
  const [slug, setSlug] = useState(season.slug);
  const [year, setYear] = useState(String(season.year));
  const [plannedEvents, setPlannedEvents] = useState(String(season.plannedEvents));
  const [minimumEvents, setMinimumEvents] = useState(String(season.minimumEvents));
  const [status, setStatus] = useState<SeasonStatus>(season.status);
  const [rulesetId, setRulesetId] = useState(String(season.rulesetId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetIdItems = useMemo(() => rulesetSelectItems(presets), [presets]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const yearNum = Number(year);
    const plannedNum = Number(plannedEvents);
    const minimumNum = Number(minimumEvents);
    if (!Number.isInteger(yearNum)) {
      setError("Year must be an integer");
      setPending(false);
      return;
    }
    if (!Number.isInteger(plannedNum) || plannedNum < 0) {
      setError("Planned events must be a non-negative integer");
      setPending(false);
      return;
    }
    if (!Number.isInteger(minimumNum) || minimumNum < 0) {
      setError("Minimum events must be a non-negative integer");
      setPending(false);
      return;
    }
    const rulesetNum = Number(rulesetId);
    if (!Number.isInteger(rulesetNum)) {
      setError("Pick a ruleset");
      setPending(false);
      return;
    }

    // Only send fields that actually changed — same convention as the
    // league settings form (the PATCH route treats an absent key as "leave
    // alone", so an untouched field never gets re-validated on an unrelated
    // save).
    const patch: Record<string, unknown> = {};
    if (name !== season.name) patch.name = name;
    if (slug !== season.slug) patch.slug = slug;
    if (yearNum !== season.year) patch.year = yearNum;
    if (plannedNum !== season.plannedEvents) patch.plannedEvents = plannedNum;
    if (minimumNum !== season.minimumEvents) patch.minimumEvents = minimumNum;
    if (status !== season.status) patch.status = status;
    if (rulesetNum !== season.rulesetId) patch.rulesetId = rulesetNum;

    if (Object.keys(patch).length === 0) {
      setPending(false);
      onSaved();
      return;
    }

    try {
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/seasons/${season.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        onSaved();
      } else {
        setError((json["error"] as string) ?? "Update failed");
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
        <DialogHeader>
          <DialogTitle>Edit season</DialogTitle>
          <DialogDescription>
            The season follows this ruleset — editing the ruleset changes this season&apos;s
            standings. Reassign it below, or edit the ruleset itself in the ruleset library.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-name">Name</Label>
            <Input
              id="edit-season-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-slug">Slug</Label>
            <Input
              id="edit-season-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-year">Year</Label>
            <Input
              id="edit-season-year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-planned">Planned events</Label>
            <Input
              id="edit-season-planned"
              type="number"
              min={0}
              value={plannedEvents}
              onChange={(e) => setPlannedEvents(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-minimum">Minimum events to qualify</Label>
            <Input
              id="edit-season-minimum"
              type="number"
              min={0}
              value={minimumEvents}
              onChange={(e) => setMinimumEvents(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-status">Status</Label>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(v) => setStatus(v as SeasonStatus)}
            >
              <SelectTrigger id="edit-season-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-ruleset">Ruleset</Label>
            <Select
              items={presetIdItems}
              value={rulesetId}
              onValueChange={(v) => setRulesetId(v ?? rulesetId)}
            >
              <SelectTrigger id="edit-season-ruleset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Reassigning recomputes this season&apos;s standings immediately — including past
            seasons. Historical results pages will reflect the new rules.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
