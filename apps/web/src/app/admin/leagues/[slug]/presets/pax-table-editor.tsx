"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { rowsToTable, tableToRows, type PaxRow } from "@/lib/pax-table-edit";

/**
 * Full-table PAX factor editor for a ruleset. Since Task R3 the stored
 * `ScoringSystem.paxTable` is the ONLY table (no built-in fallback, no
 * override semantics) — every row here is a real code+factor pair the admin
 * can edit, add, or remove outright, and `onChange` always emits the
 * COMPLETE table (see `pax-table-edit.ts`'s `rowsToTable`). A code removed
 * here is genuinely gone from the emitted table, not merged back in by the
 * caller.
 */
export function PaxTableEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [rows, setRows] = useState<PaxRow[]>(() => tableToRows(value));
  const [newCode, setNewCode] = useState("");
  const [newValue, setNewValue] = useState("1.000");
  const [addError, setAddError] = useState<string | null>(null);

  function commit(nextRows: PaxRow[]) {
    setRows(nextRows);
    onChange(rowsToTable(nextRows));
  }

  function handleValueChange(code: string, raw: number) {
    if (Number.isNaN(raw)) return;
    commit(rows.map((r) => (r.code === code ? { ...r, value: raw } : r)));
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
    const nextRows = [...rows, { code, value: parsed }].sort((a, b) => a.code.localeCompare(b.code));
    commit(nextRows);
    setNewCode("");
    setNewValue("1.000");
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        The complete set of PAX/RTP factors for this ruleset. Every season referencing it scores
        with these factors on its next ingest (or after Re-apply PAX on the season). Remove a row
        to drop that class entirely — an unlisted class resolves to 1.0.
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
                    value={row.value}
                    onChange={(e) => handleValueChange(row.code, e.target.valueAsNumber)}
                    className="w-24"
                    required
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(row.code)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No PAX factors — every class resolves to 1.0.
                </TableCell>
              </TableRow>
            )}
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
