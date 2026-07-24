"use client";

import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseScoringPolicy, type ScoringPolicy } from "@/lib/scoring-policy";
import { canonicalPaxJson } from "@/lib/pax-table-edit";
import { PaxTableEditor } from "./pax-table-editor";
import type { SeasonRow } from "./seasons-table";

export type PresetOption = { name: string };

type SeasonStatus = "active" | "completed";

const STATUS_OPTIONS: { value: SeasonStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

type Drops = ScoringPolicy["drops"];
type ClassMetric = ScoringPolicy["classMetric"];

const DROPS_OPTIONS: { value: Drops; label: string }[] = [
  { value: "fixed", label: "Fixed — best N scores count, nothing drops mid-season" },
  { value: "proportional", label: "Proportional — drops scale with completed events" },
];

const CLASS_METRIC_OPTIONS: { value: ClassMetric; label: string }[] = [
  { value: "raw", label: "Raw — class sections rank on best corrected time" },
  { value: "pax", label: "PAX — class sections rank on time × PAX index" },
];

/** Fallback when a stored Season.scoringPolicy can't be parsed — mirrors preset-dialog's DEFAULT_POLICY. */
const DEFAULT_POLICY: ScoringPolicy = {
  v: 1,
  drops: "fixed",
  paxSection: false,
  classMetric: "raw",
  conePenaltyMs: 2000,
};

/** Sentinel for "use the league's default preset" — not a real preset name. */
const DEFAULT_PRESET = "__league_default__";

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
  const [presetName, setPresetName] = useState<string>(DEFAULT_PRESET);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setYear(String(new Date().getFullYear()));
    setSlug("");
    setPlannedEvents("0");
    setPresetName(DEFAULT_PRESET);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const yearNum = Number(year);
    const plannedNum = Number(plannedEvents);
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

    const body: Record<string, unknown> = { name, year: yearNum, plannedEvents: plannedNum };
    if (slug.trim()) body.slug = slug.trim();
    if (presetName !== DEFAULT_PRESET) body.presetName = presetName;

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
            Snapshots its scoring policy from the selected ruleset (or the league&apos;s oldest
            ruleset, if none is picked) at creation time — later edits to that ruleset never change
            this season.
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
            <Label htmlFor="season-preset">Scoring ruleset</Label>
            <Select
              value={presetName}
              onValueChange={(v) => setPresetName(v ?? DEFAULT_PRESET)}
            >
              <SelectTrigger id="season-preset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_PRESET}>League default (oldest ruleset)</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
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

function EditSeasonDialog({ leagueSlug, season, onClose, onSaved }: EditProps) {
  const [name, setName] = useState(season.name);
  const [slug, setSlug] = useState(season.slug);
  const [year, setYear] = useState(String(season.year));
  const [plannedEvents, setPlannedEvents] = useState(String(season.plannedEvents));
  const [status, setStatus] = useState<SeasonStatus>(season.status);
  const [paxTable, setPaxTable] = useState(season.paxTable);
  // Every Season row is written through updateSeason/createSeason, which both
  // validate via parseScoringPolicy before persisting, so a malformed stored
  // policy should never happen — but if a legacy/hand-edited row is bad, fall
  // back to a default instead of throwing during render (that would crash
  // this dialog, the one admin surface that could repair the row). Mirrors
  // EditPresetDialog's `preset.policy ?? DEFAULT_POLICY` idiom.
  let initialPolicy: ScoringPolicy;
  let policyWasInvalid = false;
  try {
    initialPolicy = parseScoringPolicy(season.scoringPolicy);
  } catch {
    initialPolicy = DEFAULT_POLICY;
    policyWasInvalid = true;
  }
  const [drops, setDrops] = useState<Drops>(initialPolicy.drops);
  const [paxSection, setPaxSection] = useState(initialPolicy.paxSection);
  const [classMetric, setClassMetric] = useState<ClassMetric>(initialPolicy.classMetric);
  const [conePenaltyMs, setConePenaltyMs] = useState(String(initialPolicy.conePenaltyMs));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const yearNum = Number(year);
    const plannedNum = Number(plannedEvents);
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
    const coneNum = Number(conePenaltyMs);
    if (!Number.isFinite(coneNum) || coneNum < 0) {
      setError("Cone penalty must be a non-negative number");
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
    if (status !== season.status) patch.status = status;
    if (canonicalPaxJson(paxTable) !== canonicalPaxJson(season.paxTable)) patch.paxTable = paxTable;
    const newPolicy = JSON.stringify({
      v: 1, drops, paxSection, classMetric, conePenaltyMs: coneNum,
    });
    // Force a canonical rewrite when the stored policy couldn't be parsed,
    // even if the form's fields still match the fallback defaults — same as
    // EditPresetDialog's `preset.policy === null` branch.
    if (policyWasInvalid || newPolicy !== JSON.stringify(initialPolicy)) {
      patch.scoringPolicy = newPolicy;
    }

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
            Scoring changes here apply only to this season — rulesets in the library are never
            modified.
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
            <Label htmlFor="edit-season-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SeasonStatus)}>
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
          <p className="text-xs text-muted-foreground">
            Changing scoring recomputes this season&apos;s standings immediately — including past
            seasons. Historical results pages will reflect the new rules.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-drops">Drops</Label>
            <Select value={drops} onValueChange={(v) => setDrops(v as Drops)}>
              <SelectTrigger id="edit-season-drops" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DROPS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-class-metric">Class ranking metric</Label>
            <Select
              value={classMetric}
              onValueChange={(v) => setClassMetric(v as ClassMetric)}
            >
              <SelectTrigger id="edit-season-class-metric" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASS_METRIC_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="edit-season-pax-section">Overall PAX standings section</Label>
            <Switch
              id="edit-season-pax-section"
              checked={paxSection}
              onCheckedChange={setPaxSection}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-cone-penalty">Cone penalty (ms)</Label>
            <Input
              id="edit-season-cone-penalty"
              type="number"
              min={0}
              value={conePenaltyMs}
              onChange={(e) => setConePenaltyMs(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-season-pax">PAX factors</Label>
            <PaxTableEditor value={paxTable} onChange={setPaxTable} />
          </div>
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
