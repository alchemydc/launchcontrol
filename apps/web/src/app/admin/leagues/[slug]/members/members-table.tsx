"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MembershipRole } from "@/lib/membership";
import { MemberDialog } from "./member-dialog";

export type MemberRow = { msrUid: string; role: MembershipRole };

const ROLE_BADGE_VARIANT: Record<MembershipRole, "default" | "secondary" | "destructive"> = {
  ADMIN: "default",
  MEMBER: "secondary",
  // BLOCKED must read as visually distinct from an ordinary role — destructive
  // is the only variant that signals "this is a denial", not just a category.
  BLOCKED: "destructive",
};

export function MembersTable({ leagueSlug, rows }: { leagueSlug: string; rows: MemberRow[] }) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<MemberRow | null>(null);
  const [removingRow, setRemovingRow] = useState<MemberRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <MemberDialog mode="create" leagueSlug={leagueSlug} onCreated={() => router.refresh()} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>MSR UID</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.msrUid}>
              <TableCell className="font-mono text-xs">{row.msrUid}</TableCell>
              <TableCell>
                <Badge variant={ROLE_BADGE_VARIANT[row.role]}>{row.role}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingRow(row)}>
                    Change role
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRemovingRow(row)}>
                    Remove
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No members yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editingRow && (
        <MemberDialog
          mode="edit"
          leagueSlug={leagueSlug}
          member={editingRow}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null);
            router.refresh();
          }}
        />
      )}

      {removingRow && (
        <RemoveMemberDialog
          leagueSlug={leagueSlug}
          member={removingRow}
          onClose={() => setRemovingRow(null)}
          onRemoved={() => {
            setRemovingRow(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RemoveMemberDialog({
  leagueSlug,
  member,
  onClose,
  onRemoved,
}: {
  leagueSlug: string;
  member: MemberRow;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msrUid: member.msrUid }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        onRemoved();
      } else {
        // Surfaces the route's own message verbatim — including the 403
        // "you are this league's last ADMIN" refusal.
        setError((json["error"] as string) ?? "Remove failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove member</DialogTitle>
          <DialogDescription>
            Removes <span className="font-mono text-xs text-foreground">{member.msrUid}</span>{" "}
            from this league&apos;s membership entirely.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={pending}>
            {pending ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
