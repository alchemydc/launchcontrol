"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type LeaderboardRow, formatMs } from "@/lib/leaderboard";

const ALL_CLASSES = "__all__";

function SortHeader({
  label,
  isSorted,
  onClick,
  numeric = false,
}: {
  label: string;
  isSorted: false | "asc" | "desc";
  onClick: () => void;
  numeric?: boolean;
}) {
  const Icon =
    isSorted === "asc" ? ArrowUp : isSorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`-ml-2 h-8 px-2 ${numeric ? "tabular-nums" : ""}`}
    >
      {label}
      <Icon className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

export function LeaderboardTable({
  rows,
  classCodes,
}: {
  rows: LeaderboardRow[];
  classCodes: string[];
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "bestPaxMs", desc: false },
  ]);
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASSES);

  const filteredRows = useMemo(
    () =>
      classFilter === ALL_CLASSES
        ? rows
        : rows.filter((r) => r.classCode === classFilter),
    [rows, classFilter],
  );

  const columns = useMemo<ColumnDef<LeaderboardRow>[]>(
    () => [
      {
        id: "carNumber",
        accessorKey: "carNumber",
        header: ({ column }) => (
          <SortHeader
            label="#"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.carNumber}
          </span>
        ),
      },
      {
        id: "driverName",
        accessorKey: "driverName",
        header: ({ column }) => (
          <SortHeader
            label="Driver"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
          />
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.driverName}</div>
            {row.original.carDescription && (
              <div className="text-muted-foreground text-xs">
                {row.original.carDescription}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "classCode",
        accessorKey: "classCode",
        header: ({ column }) => (
          <SortHeader
            label="Class"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
          />
        ),
        cell: ({ row }) => {
          const { classCode, paxClassCode } = row.original;
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline">{classCode}</Badge>
              {paxClassCode !== classCode && (
                <span className="text-muted-foreground text-xs">
                  PAX {paxClassCode}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "bestRawMs",
        accessorFn: (row) => row.bestRawMs ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => (
          <SortHeader
            label="Best Raw"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
            numeric
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMs(row.original.bestRawMs)}</span>
        ),
      },
      {
        id: "bestPaxMs",
        accessorFn: (row) => row.bestPaxMs ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => (
          <SortHeader
            label="Best PAX"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
            numeric
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">
            {formatMs(row.original.bestPaxMs)}
          </span>
        ),
      },
      {
        id: "runs",
        header: "Runs",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.runs.map((r) => {
              const text =
                r.disposition === "DNF"
                  ? "DNF"
                  : r.disposition === "RRN"
                    ? "RRN"
                    : `${formatMs(r.correctedMs ?? r.rawTimeMs)}${
                        r.cones > 0 ? `+${r.cones}` : ""
                      }`;
              const variant =
                r.disposition === "DNF" || r.disposition === "RRN"
                  ? "destructive"
                  : "secondary";
              return (
                <Badge
                  key={r.runNumber}
                  variant={variant}
                  className="tabular-nums font-normal"
                  title={`Run ${r.runNumber}`}
                >
                  {text}
                </Badge>
              );
            })}
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">Filter class:</span>
        <Select
          value={classFilter}
          onValueChange={(v) => setClassFilter(v ?? ALL_CLASSES)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLASSES}>All classes</SelectItem>
            {classCodes.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
          {filteredRows.length} of {rows.length}
        </span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  No entries match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
