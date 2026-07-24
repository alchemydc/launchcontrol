"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MembershipRole } from "@/lib/membership";

export type MembershipGroup = {
  leagueSlug: string;
  leagueName: string;
  members: { msrUid: string; role: MembershipRole }[];
};

export type SuperUserRow = {
  msrUid: string;
  /** "env" = listed in ADMIN_MSR_UIDS, irrevocable here regardless of whether
   *  a SuperUser row also exists; "row" = DB-row-backed grant, revocable. */
  source: "env" | "row";
};

const ROLE_BADGE_VARIANT: Record<MembershipRole, "default" | "secondary" | "destructive"> = {
  ADMIN: "default",
  MEMBER: "secondary",
  BLOCKED: "destructive",
};

/** No user search exists — MSR's API only ever returns the logged-in profile. */
const MSR_UID_HELP = "MSR UID, e.g. from the member's /me page";

export function UsersTable({
  groups,
  superUsers,
}: {
  groups: MembershipGroup[];
  superUsers: SuperUserRow[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Memberships by league
        </h2>
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.leagueSlug} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{group.leagueName}</h3>
                <Link
                  href={`/admin/leagues/${group.leagueSlug}/members`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Manage
                </Link>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MSR UID</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.members.map((m) => (
                    <TableRow key={m.msrUid}>
                      <TableCell className="font-mono text-xs">{m.msrUid}</TableCell>
                      <TableCell>
                        <Badge variant={ROLE_BADGE_VARIANT[m.role]}>{m.role}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {group.members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground">
                        No members yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">No leagues yet.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Superusers
          </h2>
          <AddSuperUserDialog onGranted={() => router.refresh()} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MSR UID</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {superUsers.map((row) => (
              <SuperUserTableRow key={row.msrUid} row={row} onRevoked={() => router.refresh()} />
            ))}
            {superUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No superusers yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function SuperUserTableRow({
  row,
  onRevoked,
}: {
  row: SuperUserRow;
  onRevoked: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/superusers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msrUid: row.msrUid, granted: false }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        onRevoked();
      } else {
        setError((json["error"] as string) ?? "Revoke failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.msrUid}</TableCell>
      <TableCell>
        {row.source === "env" ? (
          <Badge variant="outline">env bootstrap</Badge>
        ) : (
          <Badge variant="secondary">granted</Badge>
        )}
      </TableCell>
      <TableCell>
        {row.source === "row" ? (
          <div className="flex flex-col gap-1">
            <Button variant="outline" size="sm" onClick={handleRevoke} disabled={pending}>
              {pending ? "Revoking..." : "Revoke"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not revocable here</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddSuperUserDialog({ onGranted }: { onGranted: () => void }) {
  const [open, setOpen] = useState(false);
  const [msrUid, setMsrUid] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMsrUid("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const trimmed = msrUid.trim();
    if (!trimmed) {
      setError("MSR UID is required");
      setPending(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/superusers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msrUid: trimmed, granted: true }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        setOpen(false);
        reset();
        onGranted();
      } else {
        setError((json["error"] as string) ?? "Grant failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button>Add superuser</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add superuser</DialogTitle>
          <DialogDescription>
            Grants platform-wide superuser access — administers every league and can manage other
            superusers.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="superuser-msr-uid">MSR UID</Label>
            <Input
              id="superuser-msr-uid"
              value={msrUid}
              onChange={(e) => setMsrUid(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{MSR_UID_HELP}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
