"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { buildPaxRows, serializePaxOverrides, type PaxRow } from "@/lib/pax-table-edit";

/**
 * Effective PAX factors for a season: the built-in RMSOLO_PAX_2026 table
 * merged with this season's overrides. Editing a value creates (or updates)
 * an override; only overrides are ever persisted via `onChange` — the
 * built-in table itself is never written back.
 */
export function PaxTableEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [rows, setRows] = useState<PaxRow[]>(() => buildPaxRows(value));
  const [newCode, setNewCode] = useState("");
  const [newValue, setNewValue] = useState("1.000");
  const [addError, setAddError] = useState<string | null>(null);

  function commit(nextRows: PaxRow[]) {
    setRows(nextRows);
    onChange(serializePaxOverrides(nextRows));
  }

  function handleValueChange(code: string, raw: number) {
    if (Number.isNaN(raw)) return;
    commit(
      rows.map((r) =>
        r.code === code ? { ...r, value: raw, overridden: r.builtin === null || raw !== r.builtin } : r,
      ),
    );
  }

  function handleReset(code: string) {
    commit(
      rows.map((r) =>
        r.code === code && r.builtin !== null ? { ...r, value: r.builtin, overridden: false } : r,
      ),
    );
  }

  function handleRemove(code: string) {
    commit(rows.filter((r) => r.code !== code));
  }

  function handleAdd() {
    const code = newCode.trim().toUpperCase();
    if (!code) {
      setAddError("Code is required");
      return;
    }
    if (rows.some((r) => r.code === code)) {
      setAddError(`"${code}" already exists`);
      return;
    }
    const parsed = Number(newValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setAddError("Factor must be a positive number");
      return;
    }
    setAddError(null);
    const nextRows = [...rows, { code, builtin: null, value: parsed, overridden: true }].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    commit(nextRows);
    setNewCode("");
    setNewValue("1.000");
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Factors below are the built-in 2026 SCCA/RMsolo table. Edit a value to override it for
        this season — only overrides are stored, and only overridden classes are touched by
        Re-apply PAX.
      </p>
      <div className="max-h-64 overflow-y-auto rounded-lg border">
        <Table>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code}>
                <TableCell className="font-mono">{row.code}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.001"
                    min="0.1"
                    max="1.5"
                    value={row.value}
                    onChange={(e) => handleValueChange(row.code, e.target.valueAsNumber)}
                    className="w-24"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {row.builtin !== null && (
                      <span className="text-xs text-muted-foreground">
                        built-in {row.builtin.toFixed(3)}
                      </span>
                    )}
                    {row.overridden && <Badge variant="secondary">Overridden</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {row.overridden && row.builtin !== null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReset(row.code)}
                    >
                      Reset
                    </Button>
                  )}
                  {row.builtin === null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(row.code)}
                    >
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Code (e.g. ZZZ)"
            className="w-32 font-mono"
          />
          <Input
            type="number"
            step="0.001"
            min="0.1"
            max="1.5"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="w-24"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            Add
          </Button>
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
      </div>
    </div>
  );
}
