"use client";

/**
 * "Find my class" — the picker at the top of the classing page.
 *
 * Narrows model -> year -> trim and resolves the class client-side. The whole
 * season's model is a few dozen vehicles, so it ships as a prop and every
 * change is a local filter: no API route, no round trip, works while the page
 * is still hydrating the table below it.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  lookupClass,
  lookupModels,
  lookupTrims,
  lookupYears,
  vehicleLineText,
  type ClassingModel,
} from "@/lib/classing";

/** Upstream spells "no trim split" as a trim literally named "all". */
const NO_TRIM_SPLIT = "all";

function trimLabel(trim: string): string {
  return trim === NO_TRIM_SPLIT ? "Any trim" : trim;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function ClassingLookup({
  model,
  season,
  seasonLabel,
}: {
  model: ClassingModel;
  /** The season year the answer applies to. */
  season: number;
  /** Display name of that season, e.g. "2026 Season". */
  seasonLabel: string;
}) {
  const [modelName, setModelName] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [trim, setTrim] = useState<string | null>(null);

  const models = useMemo(() => lookupModels(model, season), [model, season]);
  const years = useMemo(
    () => (modelName ? lookupYears(model, season, modelName, season) : []),
    [model, season, modelName],
  );
  const trims = useMemo(
    () => (modelName && year ? lookupTrims(model, season, modelName, year) : []),
    [model, season, modelName, year],
  );

  const matches = useMemo(
    () =>
      modelName && year && trim
        ? lookupClass(model, { modelName, year, trim, season })
        : [],
    [model, season, modelName, year, trim],
  );

  // Each step invalidates the ones after it — keeping a stale year from the
  // previous model would silently resolve to the wrong class.
  const onModel = (v: string) => {
    setModelName(v);
    setYear(null);
    setTrim(null);
  };
  const onYear = (v: string) => {
    setYear(Number(v));
    setTrim(null);
  };

  const complete = modelName !== null && year !== null && trim !== null;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Find my class
      </h2>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Model">
          <Select value={modelName ?? ""} onValueChange={(v) => v && onModel(String(v))}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue>{modelName ?? "Select…"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Year">
          <Select
            value={year === null ? "" : String(year)}
            onValueChange={(v) => v && onYear(String(v))}
            disabled={modelName === null}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue>{year === null ? "Select…" : String(year)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Trim">
          <Select
            value={trim ?? ""}
            onValueChange={(v) => v && setTrim(String(v))}
            disabled={year === null}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue>{trim === null ? "Select…" : trimLabel(trim)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {trims.map((t) => (
                <SelectItem key={t} value={t}>
                  {trimLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {complete && matches.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No class listed for that combination in the {seasonLabel}. Check the table below, or ask
          an event organizer.
        </p>
      )}

      {matches.length > 0 && (
        <div className="mt-4 space-y-2">
          {matches.length > 1 && (
            <p className="text-xs text-muted-foreground">
              More than one class covers that car — the ranges overlap, so confirm with an
              organizer.
            </p>
          )}
          {matches.map((match) => (
            <div
              key={`${match.classCode} ${match.vehicle.title} ${match.vehicle.years}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
            >
              <Badge variant="default">{match.classCode}</Badge>
              <span className="text-sm">{vehicleLineText(match.vehicle)}</span>
              {/* The one condition a dropdown cannot answer: state it rather
                  than letting the result imply a class the car may not be in. */}
              {match.displacementMax && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  only up to {match.displacementMax} — larger engines class differently
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
