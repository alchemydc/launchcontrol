import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audit log",
};

const MAX_ROWS = 200;

function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

export default async function AdminAuditPage() {
  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { id: "desc" },
    take: MAX_ROWS,
  });

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-5xl flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Admin ingest, edit, and delete actions, most recent first
          {rows.length === MAX_ROWS ? ` (showing the latest ${MAX_ROWS})` : ""}.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatTimestamp(row.createdAt)}
                </TableCell>
                <TableCell className="font-medium">{row.action}</TableCell>
                <TableCell>{row.actorName}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.targetSlug ?? "—"}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      view
                    </summary>
                    <pre className="mt-2 max-w-md overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                      {prettyDetail(row.detail)}
                    </pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No admin actions recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
