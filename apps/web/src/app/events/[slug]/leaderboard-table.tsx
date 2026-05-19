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
        id: "rank",
        header: () => (
          <span className="tabular-nums text-center block w-full">#</span>
        ),
        enableSorting: false,
        cell: ({ row, table }) => {
          const sortedRows = table.getSortedRowModel().rows;
          const rank = sortedRows.findIndex((r) => r.id === row.id) + 1;
          const rankClass =
            rank === 1
              ? "text-primary font-bold tabular-nums text-center"
              : rank <= 3
                ? "font-semibold text-foreground tabular-nums text-center"
                : "text-muted-foreground tabular-nums text-center";
          return <span className={rankClass}>{rank}</span>;
        },
      },
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
                  : "success";
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
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 shadow-sm md:flex-row md:items-center">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Filter class
        </span>
        <Select
          value={classFilter}
          onValueChange={(v) => setClassFilter(v ?? ALL_CLASSES)}
        >
          <SelectTrigger className="w-full bg-background md:w-44">
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
        <span className="rounded-full bg-background px-3 py-1 text-sm tabular-nums text-muted-foreground md:ml-auto">
          {filteredRows.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <Table className="min-w-[760px]">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="bg-muted/40 hover:bg-muted/40">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-11 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                  >
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
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No entries match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const sortedRows = table.getSortedRowModel().rows;
                const rank = sortedRows.findIndex((r) => r.id === row.id) + 1;
                return (
                  <TableRow
                    key={row.id}
                    className={
                      rank === 1
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "odd:bg-background even:bg-muted/10 hover:bg-accent/30"
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-3 py-3 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
