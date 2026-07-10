"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditEventDialog } from "./edit-event-dialog";
import { DeleteEventDialog } from "./delete-event-dialog";

export type EventRow = {
  id: number;
  name: string;
  date: string; // ISO
  slug: string;
  location: string | null;
  entries: number;
  runs: number;
  videos: number;
  createdAt: string; // ISO
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function EventsTable({ rows }: { rows: EventRow[] }) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<EventRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<EventRow | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Entries</TableHead>
            <TableHead>Runs</TableHead>
            <TableHead>Videos</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{formatDate(row.date)}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.slug}
              </TableCell>
              <TableCell>{row.entries}</TableCell>
              <TableCell>{row.runs}</TableCell>
              <TableCell>{row.videos}</TableCell>
              <TableCell>{formatDate(row.createdAt)}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingRow(row)}>
                    Edit
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeletingRow(row)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No events yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editingRow && (
        <EditEventDialog
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSuccess={() => {
            setEditingRow(null);
            router.refresh();
          }}
        />
      )}
      {deletingRow && (
        <DeleteEventDialog
          row={deletingRow}
          onClose={() => setDeletingRow(null)}
          onSuccess={() => {
            setDeletingRow(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
