"use client";

import { useMemo, useRef, useState } from "react";
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
import { DriverLink } from "@/components/driver-link";
import { RankPill } from "@/components/podium";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type LeaderboardRow, formatMs, formatDelta } from "@/lib/leaderboard";

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

function RunChips({ runs }: { runs: LeaderboardRow["runs"] }) {
  if (runs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {runs.map((r) => {
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
            : r.cones > 0
              ? "warning"
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
  );
}

function ClassChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "inline-flex items-center rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary transition-colors"
          : "inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:border-primary/60 focus-visible:text-primary focus-visible:outline-none"
      }
    >
      {children}
    </button>
  );
}

function ClassBadge({
  classCode,
  paxClassCode,
}: {
  classCode: string;
  paxClassCode: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline">{classCode}</Badge>
      {paxClassCode !== classCode && (
        <span className="text-muted-foreground text-xs">PAX {paxClassCode}</span>
      )}
    </div>
  );
}

function DriverCard({
  row,
  rank,
  delta,
}: {
  row: LeaderboardRow;
  rank: number;
  delta: { fromPrior: number | null; fromP1: number | null } | undefined;
}) {
  return (
    <li className="px-4 py-3 odd:bg-background even:bg-muted/10">
      <div className="flex items-start gap-3">
        <RankPill rank={rank} />
        <div className="min-w-0 flex-1">
          <DriverLink driverId={row.driverId} name={row.driverName} className="block truncate" />
          {row.carDescription && (
            <p className="text-xs text-muted-foreground truncate">
              {row.carDescription}
            </p>
          )}
          <div className="mt-1.5">
            <ClassBadge
              classCode={row.classCode}
              paxClassCode={row.paxClassCode}
            />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-semibold tabular-nums leading-none">
            {formatMs(row.bestRawMs)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            time
          </div>
        </div>
      </div>
      {delta && delta.fromP1 != null && (
        <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
          {formatDelta(delta.fromPrior)} from prior · {formatDelta(delta.fromP1)} from P1
        </div>
      )}
      {row.runs.length > 0 && (
        <div className="mt-3">
          <RunChips runs={row.runs} />
        </div>
      )}
    </li>
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
    { id: "bestRawMs", desc: false },
  ]);
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASSES);
  const rankByIdRef = useRef<Map<string, number>>(new Map());

  const filteredRows = useMemo(
    () =>
      classFilter === ALL_CLASSES
        ? rows
        : rows.filter((r) => r.classCode === classFilter),
    [rows, classFilter],
  );

  const deltaByRow = useMemo(() => {
    const map = new Map<LeaderboardRow, { fromPrior: number | null; fromP1: number | null }>();
    const ranked = filteredRows
      .filter((r) => r.bestRawMs != null)
      .sort((a, b) => a.bestRawMs! - b.bestRawMs!);
    const leader = ranked[0]?.bestRawMs ?? null;
    ranked.forEach((r, i) => {
      if (i === 0) {
        map.set(r, { fromPrior: null, fromP1: null });
      } else {
        map.set(r, {
          fromPrior: r.bestRawMs! - ranked[i - 1]!.bestRawMs!,
          fromP1: leader == null ? null : r.bestRawMs! - leader,
        });
      }
    });
    return map;
  }, [filteredRows]);

  const columns = useMemo<ColumnDef<LeaderboardRow>[]>(
    () => [
      {
        id: "rank",
        header: () => <span className="text-left block">#</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <RankPill rank={rankByIdRef.current.get(row.id) ?? 0} />
        ),
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
            <DriverLink driverId={row.original.driverId} name={row.original.driverName} />
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
        cell: ({ row }) => (
          <ClassBadge
            classCode={row.original.classCode}
            paxClassCode={row.original.paxClassCode}
          />
        ),
      },
      {
        id: "bestRawMs",
        accessorFn: (row) => row.bestRawMs ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => (
          <SortHeader
            label="Time"
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
        id: "fromPrior",
        header: "from prior",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatDelta(deltaByRow.get(row.original)?.fromPrior ?? null)}
          </span>
        ),
      },
      {
        id: "fromP1",
        header: "from P1",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatDelta(deltaByRow.get(row.original)?.fromP1 ?? null)}
          </span>
        ),
      },
      {
        id: "runs",
        header: "Runs",
        enableSorting: false,
        cell: ({ row }) => <RunChips runs={row.original.runs} />,
      },
    ],
    [deltaByRow],
  );

  // React Compiler can't safely memoize TanStack Table's returned functions;
  // we accept that limitation here because the table state lives in this
  // component and isn't passed to other memoized consumers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const sortedRows = table.getRowModel().rows;

  const newRankMap = new Map<string, number>();
  sortedRows.forEach((r, i) => newRankMap.set(r.id, i + 1));
  rankByIdRef.current = newRankMap;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Filter header strip */}
      <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3 border-b border-border/60 md:flex-row md:items-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
          Filter class
        </span>
        <nav
          aria-label="Filter by class"
          className="-mx-1 px-1 overflow-x-auto flex-1"
        >
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <ClassChip
                active={classFilter === ALL_CLASSES}
                onClick={() => setClassFilter(ALL_CLASSES)}
              >
                All
              </ClassChip>
            </li>
            {classCodes.map((code) => (
              <li key={code}>
                <ClassChip
                  active={classFilter === code}
                  onClick={() => setClassFilter(code)}
                >
                  {code}
                </ClassChip>
              </li>
            ))}
          </ul>
        </nav>
        <span className="rounded-full bg-background px-3 py-1 text-xs tabular-nums text-muted-foreground shrink-0 self-start md:self-auto md:ml-auto">
          {filteredRows.length} of {rows.length}
        </span>
      </div>

      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {sortedRows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            No entries match the current filter.
          </li>
        ) : (
          sortedRows.map((row, i) => (
            <DriverCard key={row.id} row={row.original} rank={i + 1} delta={deltaByRow.get(row.original)} />
          ))
        )}
      </ul>

      {/* Desktop: sortable table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="bg-muted/20 hover:bg-muted/20">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-11 px-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No entries match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row, i) => {
                const rank = i + 1;
                return (
                  <TableRow
                    key={row.id}
                    className={
                      rank <= 3
                        ? "hover:bg-accent/20"
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
    </section>
  );
}
