"use client";

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
import type { PointsBasis, PointsSystem } from "@/lib/scoring-policy";

/** Starting table when an admin first picks the position system (issue #110's example). */
export const DEFAULT_POSITION_TABLE = [20, 15, 12, 10, 8, 6, 4, 2, 1];
const DEFAULT_BEYOND_TABLE = 1;

/**
 * A ruleset's points system is a discriminated union, but the two ratio1000
 * variants differ only in `basis` — so the select below folds type and basis
 * into one choice rather than showing a second control that only matters for
 * one of three options. `position` then reveals its own basis control, since
 * for a position table both readings are genuinely useful.
 */
type Choice = "ratio-class" | "ratio-event" | "position";

const CHOICE_OPTIONS: { value: Choice; label: string }[] = [
  { value: "ratio-class", label: "Per class — every class winner scores 1000" },
  { value: "ratio-event", label: "Event-wide — one PAX-relative score per driver per event" },
  { value: "position", label: "Finish position table" },
];

const BASIS_OPTIONS: { value: PointsBasis; label: string }[] = [
  { value: "class", label: "Class — position within each class section" },
  { value: "event", label: "Overall PAX — position across the whole event" },
];

function toChoice(points: PointsSystem): Choice {
  if (points.type === "position") return "position";
  return points.basis === "event" ? "ratio-event" : "ratio-class";
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

/** Human-readable summary for the presets table's Points column. */
export function describePointsSystem(points: PointsSystem): string {
  if (points.type === "ratio1000") {
    return points.basis === "event" ? "Event-wide" : "Per class";
  }
  const places = points.table.length;
  return `Position table (${places} place${places === 1 ? "" : "s"})`;
}

export function PointsSystemEditor({
  value,
  onChange,
}: {
  value: PointsSystem;
  onChange: (next: PointsSystem) => void;
}) {
  function handleChoiceChange(next: Choice) {
    if (next === "ratio-class") return onChange({ type: "ratio1000", basis: "class" });
    if (next === "ratio-event") return onChange({ type: "ratio1000", basis: "event" });
    onChange({
      type: "position",
      table: value.type === "position" ? value.table : [...DEFAULT_POSITION_TABLE],
      beyondTable: value.type === "position" ? value.beyondTable : DEFAULT_BEYOND_TABLE,
      basis: value.basis,
    });
  }

  function updatePosition(patch: { table?: number[]; beyondTable?: number; basis?: PointsBasis }) {
    if (value.type !== "position") return;
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="points-system">Points system</Label>
        <Select
          items={CHOICE_OPTIONS}
          value={toChoice(value)}
          onValueChange={(v) => handleChoiceChange(v as Choice)}
        >
          <SelectTrigger id="points-system" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHOICE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.type === "position" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="points-basis">Ranked within</Label>
            <Select
              items={BASIS_OPTIONS}
              value={value.basis}
              onValueChange={(v) => updatePosition({ basis: v as PointsBasis })}
            >
              <SelectTrigger id="points-basis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASIS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Points by finishing position</Label>
            <div className="flex flex-col gap-1.5">
              {value.table.map((points, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-sm text-muted-foreground">
                    {ordinal(index + 1)}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={String(points)}
                    aria-label={`${ordinal(index + 1)} place points`}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next) || next < 0) return;
                      updatePosition({
                        table: value.table.map((v, i) => (i === index ? next : v)),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updatePosition({
                    table: [...value.table, value.table[value.table.length - 1] ?? 0],
                  })
                }
              >
                Add position
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={value.table.length <= 1}
                onClick={() => updatePosition({ table: value.table.slice(0, -1) })}
              >
                Remove last
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tied times share the higher position&apos;s points, and the positions they cover are
              skipped.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="points-beyond">Points beyond the table</Label>
            <Input
              id="points-beyond"
              type="number"
              min={0}
              value={String(value.beyondTable)}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next) || next < 0) return;
                updatePosition({ beyondTable: next });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
