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
import type { ScoringPolicy } from "@/lib/scoring-policy";
import { buildPaxRows, canonicalPaxJson, serializePaxOverrides } from "@/lib/pax-table-edit";
import { PaxTableEditor } from "./pax-table-editor";
import type { PresetRow } from "./presets-table";

type Drops = ScoringPolicy["drops"];

const DROPS_OPTIONS: { value: Drops; label: string }[] = [
  { value: "fixed", label: "Fixed — count best qualifying scores regardless of season progress" },
  { value: "proportional", label: "Proportional — drops scale with completed events" },
];

/** Sensible defaults when creating a preset, or recovering from an unparseable stored policy. */
const DEFAULT_POLICY: ScoringPolicy = {
  v: 2,
  drops: "fixed",
  paxSection: false,
  conePenaltyMs: 2000,
};

function serializePolicy(fields: {
  drops: Drops;
  paxSection: boolean;
  conePenaltyMs: number;
}): string {
  const policy: ScoringPolicy = { v: 2, ...fields };
  return JSON.stringify(policy);
}

type CreateProps = {
  mode: "create";
  leagueSlug: string;
  onCreated: () => void;
};

type EditProps = {
  mode: "edit";
  leagueSlug: string;
  preset: PresetRow;
  onClose: () => void;
  onSaved: () => void;
};

export function PresetDialog(props: CreateProps | EditProps) {
  if (props.mode === "create") return <CreatePresetDialog {...props} />;
  return <EditPresetDialog {...props} />;
}

function CreatePresetDialog({ leagueSlug, onCreated }: CreateProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [drops, setDrops] = useState<Drops>(DEFAULT_POLICY.drops);
  const [paxSection, setPaxSection] = useState(DEFAULT_POLICY.paxSection);
  const [conePenaltyMs, setConePenaltyMs] = useState(String(DEFAULT_POLICY.conePenaltyMs));
  // Overrides-only JSON (PaxTableEditor's serialization); the server merges
  // it over the built-in table so the stored ruleset table stays COMPLETE.
  const [paxTable, setPaxTable] = useState("{}");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDrops(DEFAULT_POLICY.drops);
    setPaxSection(DEFAULT_POLICY.paxSection);
    setConePenaltyMs(String(DEFAULT_POLICY.conePenaltyMs));
    setPaxTable("{}");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const coneMs = Number(conePenaltyMs);
    if (!Number.isFinite(coneMs) || coneMs < 0) {
      setError("Cone penalty must be a non-negative number");
      setPending(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          policyJson: serializePolicy({ drops, paxSection, conePenaltyMs: coneMs }),
          paxTableJson: paxTable,
        }),
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
      <DialogTrigger render={<Button>Create ruleset</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create scoring ruleset</DialogTitle>
          <DialogDescription>
            Seasons reference a ruleset live — every season pointed at this ruleset scores with
            its current policy and PAX table.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard PCA"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-drops">Drops</Label>
            <Select value={drops} onValueChange={(v) => setDrops(v as Drops)}>
              <SelectTrigger id="preset-drops" className="w-full">
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
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="preset-pax-section">Overall PAX standings section</Label>
            <Switch
              id="preset-pax-section"
              checked={paxSection}
              onCheckedChange={setPaxSection}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-cone-penalty">Cone penalty (ms)</Label>
            <Input
              id="preset-cone-penalty"
              type="number"
              min={0}
              value={conePenaltyMs}
              onChange={(e) => setConePenaltyMs(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PAX factors</Label>
            <PaxTableEditor value={paxTable} onChange={setPaxTable} />
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

function EditPresetDialog({ leagueSlug, preset, onClose, onSaved }: EditProps) {
  const initialPolicy = preset.policy ?? DEFAULT_POLICY;
  const [name, setName] = useState(preset.name);
  const [drops, setDrops] = useState<Drops>(initialPolicy.drops);
  const [paxSection, setPaxSection] = useState(initialPolicy.paxSection);
  const [conePenaltyMs, setConePenaltyMs] = useState(String(initialPolicy.conePenaltyMs));
  // Overrides-only JSON, derived from the stored COMPLETE table: what the
  // PaxTableEditor edits and what the server re-merges over the built-in
  // table on save.
  const [initialOverrides] = useState(() => serializePaxOverrides(buildPaxRows(preset.paxTable)));
  const [paxTable, setPaxTable] = useState(initialOverrides);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const coneMs = Number(conePenaltyMs);
    if (!Number.isFinite(coneMs) || coneMs < 0) {
      setError("Cone penalty must be a non-negative number");
      setPending(false);
      return;
    }

    const policyChanged =
      drops !== initialPolicy.drops ||
      paxSection !== initialPolicy.paxSection ||
      coneMs !== initialPolicy.conePenaltyMs ||
      preset.policy === null; // unparseable stored row — always rewrite it in canonical form

    const patch: Record<string, unknown> = {};
    if (name !== preset.name) patch.name = name;
    if (policyChanged) {
      patch.policyJson = serializePolicy({ drops, paxSection, conePenaltyMs: coneMs });
    }
    if (canonicalPaxJson(paxTable) !== canonicalPaxJson(initialOverrides)) {
      patch.paxTableJson = paxTable;
    }

    if (Object.keys(patch).length === 0) {
      setPending(false);
      onSaved();
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/leagues/${leagueSlug}/presets?name=${encodeURIComponent(preset.name)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
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
          <DialogTitle>Edit scoring ruleset</DialogTitle>
          <DialogDescription>
            Seasons reference a ruleset live — saving changes here recomputes standings for
            every season pointed at this ruleset, including past seasons.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-preset-name">Name</Label>
            <Input
              id="edit-preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-preset-drops">Drops</Label>
            <Select value={drops} onValueChange={(v) => setDrops(v as Drops)}>
              <SelectTrigger id="edit-preset-drops" className="w-full">
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
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="edit-preset-pax-section">Overall PAX standings section</Label>
            <Switch
              id="edit-preset-pax-section"
              checked={paxSection}
              onCheckedChange={setPaxSection}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-preset-cone-penalty">Cone penalty (ms)</Label>
            <Input
              id="edit-preset-cone-penalty"
              type="number"
              min={0}
              value={conePenaltyMs}
              onChange={(e) => setConePenaltyMs(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PAX factors</Label>
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
