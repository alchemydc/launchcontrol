"use client";

import { useMemo, useState } from "react";
import {
  type Column,
  type ColumnDef,
  type Row,
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
import { ClassBadge, type ClassingHints } from "@/components/class-badge";
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

function DriverCard({
  row,
  rank,
  delta,
  paxView = false,
  driverBasePath,
  classing,
}: {
  row: LeaderboardRow;
  rank: number | undefined;
  delta: { fromPrior: number | null; fromP1: number | null } | undefined;
  paxView?: boolean;
  driverBasePath?: string;
  classing?: ClassingHints;
}) {
  return (
    <li className="px-4 py-3 odd:bg-background even:bg-muted/10">
      <div className="flex items-start gap-3">
        <RankPill rank={rank} />
        <div className="min-w-0 flex-1">
          <DriverLink
            driverId={row.driverId}
            name={row.driverName}
            className="block truncate"
            basePath={driverBasePath}
          />
          {row.carDescription && (
            <p className="text-xs text-muted-foreground truncate">
              {row.carDescription}
            </p>
          )}
          <div className="mt-1.5">
            <ClassBadge
              classCode={row.classCode}
              paxClassCode={row.paxClassCode}
              classing={classing}
            />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-semibold tabular-nums leading-none">
            {formatMs(paxView ? row.bestPaxMs : row.bestRawMs)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {paxView ? "pax time" : "time"}
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

/**
 * The rows of one already-chosen event view. Which rows those are, and which
 * metric ranks them, is decided upstream by `resolveEventView` and expressed
 * by the route — this component filters nothing.
 *
 * (Through #99 it also owned a client-side class-filter chip row. Routing
 * class selection made that unreachable, and it has been removed.)
 */
export function LeaderboardTable({
  rows,
  paxView,
  driverBasePath,
  classing,
}: {
  rows: LeaderboardRow[];
  /** Rank and show gaps on the PAX-indexed metric rather than raw time. */
  paxView: boolean;
  /** "" for the legacy route (byte-identical to pre-Task-20 driver hrefs),
   *  "/l/[slug]" for league-scoped — threaded to every `DriverLink` below. */
  driverBasePath?: string;
  /** Class hover cards; absent for a league with no classing model. */
  classing?: ClassingHints;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: paxView ? "bestPaxMs" : "bestRawMs", desc: false },
  ]);
  const paxMetric = paxView;
  const filteredRows = rows;

  const { deltaByRow, rankByRow } = useMemo(() => {
    // Rank and gaps use the view's metric: PAX-indexed best in the PAX view
    // and in heterogeneous (run-group) class views, raw elsewhere.
    const metric = (r: LeaderboardRow) => (paxMetric ? r.bestPaxMs : r.bestRawMs);
    const delta = new Map<LeaderboardRow, { fromPrior: number | null; fromP1: number | null }>();
    const rank = new Map<LeaderboardRow, number>();
    const ranked = filteredRows
      .filter((r) => metric(r) != null)
      .sort((a, b) => metric(a)! - metric(b)!);
    const leader = ranked[0] != null ? metric(ranked[0]) : null;
    ranked.forEach((r, i) => {
      rank.set(r, i + 1);
      if (i === 0) {
        delta.set(r, { fromPrior: null, fromP1: null });
      } else {
        delta.set(r, {
          fromPrior: metric(r)! - metric(ranked[i - 1]!)!,
          fromP1: leader == null ? null : metric(r)! - leader,
        });
      }
    });
    return { deltaByRow: delta, rankByRow: rank };
  }, [filteredRows, paxMetric]);

  const columns = useMemo<ColumnDef<LeaderboardRow>[]>(
    () => [
      {
        id: "rank",
        header: () => <span className="text-left block">#</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <RankPill rank={rankByRow.get(row.original)} />
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
            <DriverLink
              driverId={row.original.driverId}
              name={row.original.driverName}
              basePath={driverBasePath}
            />
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
            classing={classing}
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
      // PAX view only: the indexed time the ranking is based on.
      ...(paxMetric
        ? [
            {
              id: "bestPaxMs",
              accessorFn: (row: LeaderboardRow) => row.bestPaxMs ?? Number.POSITIVE_INFINITY,
              header: ({ column }: { column: Column<LeaderboardRow, unknown> }) => (
                <SortHeader
                  label="PAX time"
                  isSorted={column.getIsSorted()}
                  onClick={() => column.toggleSorting()}
                  numeric
                />
              ),
              cell: ({ row }: { row: Row<LeaderboardRow> }) => (
                <span className="tabular-nums font-semibold">
                  {formatMs(row.original.bestPaxMs)}
                </span>
              ),
            } satisfies ColumnDef<LeaderboardRow>,
          ]
        : []),
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
    [deltaByRow, rankByRow, paxMetric, driverBasePath, classing],
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

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {sortedRows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {"No entries."}
          </li>
        ) : (
          sortedRows.map((row) => (
            <DriverCard
              key={row.id}
              row={row.original}
              rank={rankByRow.get(row.original)}
              delta={deltaByRow.get(row.original)}
              paxView={paxMetric}
              driverBasePath={driverBasePath}
              classing={classing}
            />
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
                  {"No entries."}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => {
                const rank = rankByRow.get(row.original);
                return (
                  <TableRow
                    key={row.id}
                    className={
                      rank != null && rank <= 3
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
