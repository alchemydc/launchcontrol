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
import type { CombinedResultRow, CombinedResults, CombinedSection } from "@/lib/combined-event";
import { formatMs, formatDelta } from "@/lib/leaderboard";

const ALL_CLASSES = "__all__";

function SortHeader({
  label,
  isSorted,
  onClick,
  numeric = false,
  title,
}: {
  label: string;
  isSorted: false | "asc" | "desc";
  onClick: () => void;
  numeric?: boolean;
  title?: string;
}) {
  const Icon =
    isSorted === "asc" ? ArrowUp : isSorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      className={`-ml-2 h-8 px-2 ${numeric ? "tabular-nums" : ""}`}
    >
      {label}
      <Icon className="ml-1 h-3.5 w-3.5" />
    </Button>
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

function SessionTime({
  session,
}: {
  session: CombinedResultRow["sessions"][number];
}) {
  if (session.correctedMs == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums">
      {session.runNumber != null && session.runNumber > 0 && (
        <span className="text-muted-foreground/70">R{session.runNumber}: </span>
      )}
      {formatMs(session.correctedMs)}
    </span>
  );
}

// Short per-session column label: the part of the session name that isn't the
// shared combined label (e.g. "Cone in 60 Seconds (A)" → "(A)").
function sessionShortLabel(sessionName: string, combinedLabel: string): string {
  if (combinedLabel !== "" && sessionName.startsWith(combinedLabel)) {
    const rest = sessionName.slice(combinedLabel.length).trim();
    if (rest !== "") return rest;
  }
  return sessionName;
}

function DriverCard({
  row,
  rank,
  sessionLabels,
  delta,
}: {
  row: CombinedResultRow;
  rank: number | undefined;
  sessionLabels: string[];
  delta: { fromPrior: number | null; fromP1: number | null } | undefined;
}) {
  return (
    <li className="px-4 py-3 odd:bg-background even:bg-muted/10">
      <div className="flex items-start gap-3">
        <RankPill rank={rank} />
        <div className="min-w-0 flex-1">
          <DriverLink driverId={row.driverId} name={row.driverName} className="block truncate" />
          {row.carDescription && (
            <p className="text-xs text-muted-foreground truncate">{row.carDescription}</p>
          )}
          <div className="mt-1.5">
            <Badge variant="outline">{row.classCode}</Badge>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-semibold tabular-nums leading-none">
            {formatMs(row.sumMs)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            time sum
          </div>
        </div>
      </div>
      {delta && delta.fromP1 != null && (
        <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
          {formatDelta(delta.fromPrior)} from prior · {formatDelta(delta.fromP1)} from P1
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {row.sessions.map((s, i) => (
          <span key={s.eventId} className="text-muted-foreground">
            <span className="text-[10px] uppercase tracking-wider">{sessionLabels[i]}</span>{" "}
            <SessionTime session={s} />
          </span>
        ))}
      </div>
    </li>
  );
}

function UnrankedList({ rows }: { rows: CombinedResultRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-border/60 px-4 py-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        No score — missed a session or class mismatch
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.driverId}
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-sm"
          >
            <DriverLink driverId={row.driverId} name={row.driverName} className="shrink-0" />
            {row.classCode && (
              <Badge variant="outline" className="text-[10px]">
                {row.classCode}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {row.classMismatch
                ? "raced a different class in each session"
                : `missing ${row.missingSessions.join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CombinedTable({ results }: { results: CombinedResults }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "sumMs", desc: false }]);
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASSES);

  const classCodes = useMemo(
    () => results.classes.map((c) => c.classCode).filter((c): c is string => c != null),
    [results.classes],
  );

  const section: CombinedSection = useMemo(() => {
    if (classFilter === ALL_CLASSES) return results.overall;
    return (
      results.classes.find((c) => c.classCode === classFilter) ?? {
        classCode: classFilter,
        ranked: [],
        unranked: [],
      }
    );
  }, [results, classFilter]);

  const sessionLabels = useMemo(
    () => results.sessions.map((s) => sessionShortLabel(s.name, results.label)),
    [results],
  );

  // Rank + deltas come from Time Sum order within the current filter,
  // independent of the display sort (same approach as the event page).
  const { deltaByRow, rankByRow } = useMemo(() => {
    const delta = new Map<CombinedResultRow, { fromPrior: number | null; fromP1: number | null }>();
    const rank = new Map<CombinedResultRow, number>();
    const ranked = [...section.ranked].sort((a, b) => (a.sumMs ?? 0) - (b.sumMs ?? 0));
    const leader = ranked[0]?.sumMs ?? null;
    ranked.forEach((r, i) => {
      rank.set(r, i + 1);
      if (i === 0) {
        delta.set(r, { fromPrior: null, fromP1: null });
      } else {
        delta.set(r, {
          fromPrior: (r.sumMs ?? 0) - (ranked[i - 1]!.sumMs ?? 0),
          fromP1: leader == null ? null : (r.sumMs ?? 0) - leader,
        });
      }
    });
    return { deltaByRow: delta, rankByRow: rank };
  }, [section]);

  const columns = useMemo<ColumnDef<CombinedResultRow>[]>(() => {
    const sessionColumns: ColumnDef<CombinedResultRow>[] = results.sessions.map((s, i) => ({
      id: `session-${s.id}`,
      accessorFn: (row) => row.sessions[i]?.correctedMs ?? Number.POSITIVE_INFINITY,
      header: ({ column }) => (
        <SortHeader
          label={sessionLabels[i] ?? s.name}
          title={s.name}
          isSorted={column.getIsSorted()}
          onClick={() => column.toggleSorting()}
          numeric
        />
      ),
      cell: ({ row }) => {
        const session = row.original.sessions[i];
        if (session == null) return <span className="text-muted-foreground">—</span>;
        return <SessionTime session={session} />;
      },
    }));

    return [
      {
        id: "rank",
        header: () => <span className="text-left block">#</span>,
        enableSorting: false,
        cell: ({ row }) => <RankPill rank={rankByRow.get(row.original)} />,
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
          <span className="tabular-nums text-muted-foreground">{row.original.carNumber}</span>
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
              <div className="text-muted-foreground text-xs">{row.original.carDescription}</div>
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
        cell: ({ row }) => <Badge variant="outline">{row.original.classCode}</Badge>,
      },
      ...sessionColumns,
      {
        id: "sumMs",
        accessorFn: (row) => row.sumMs ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => (
          <SortHeader
            label="Time Sum"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting()}
            numeric
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold">{formatMs(row.original.sumMs)}</span>
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
    ];
  }, [results.sessions, sessionLabels, deltaByRow, rankByRow]);

  // React Compiler can't safely memoize TanStack Table's returned functions;
  // we accept that limitation here because the table state lives in this
  // component and isn't passed to other memoized consumers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: section.ranked,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const sortedRows = table.getRowModel().rows;
  const totalCount = results.overall.ranked.length + results.overall.unranked.length;
  const filteredCount = section.ranked.length + section.unranked.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Filter header strip */}
      <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3 border-b border-border/60 md:flex-row md:items-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
          Filter class
        </span>
        <nav aria-label="Filter by class" className="-mx-1 px-1 overflow-x-auto flex-1">
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
                <ClassChip active={classFilter === code} onClick={() => setClassFilter(code)}>
                  {code}
                </ClassChip>
              </li>
            ))}
          </ul>
        </nav>
        <span className="rounded-full bg-background px-3 py-1 text-xs tabular-nums text-muted-foreground shrink-0 self-start md:self-auto md:ml-auto">
          {filteredCount} of {totalCount}
        </span>
      </div>

      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {sortedRows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            No qualifying results for the current filter.
          </li>
        ) : (
          sortedRows.map((row) => (
            <DriverCard
              key={row.id}
              row={row.original}
              rank={rankByRow.get(row.original)}
              sessionLabels={sessionLabels}
              delta={deltaByRow.get(row.original)}
            />
          ))
        )}
      </ul>

      {/* Desktop: sortable table */}
      <div className="hidden md:block overflow-x-auto">
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
                      : flexRender(header.column.columnDef.header, header.getContext())}
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
                  No qualifying results for the current filter.
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

      <UnrankedList rows={section.unranked} />
    </section>
  );
}
