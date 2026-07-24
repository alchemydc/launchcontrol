"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MembershipRole } from "@/lib/membership";
import type { MemberRow } from "./members-table";

const ROLE_OPTIONS: { value: MembershipRole; label: string }[] = [
  { value: "ADMIN", label: "Admin — manage league settings, seasons, rulesets, members" },
  { value: "MEMBER", label: "Member — counts toward this league's membership gating" },
  { value: "BLOCKED", label: "Blocked — explicitly denied access to this league" },
];

/** No user search exists — MSR's API only ever returns the logged-in profile. */
const MSR_UID_HELP = "MSR UID, e.g. from the member's /me page";

type CreateProps = {
  mode: "create";
  leagueSlug: string;
  onCreated: () => void;
};

type EditProps = {
  mode: "edit";
  leagueSlug: string;
  member: MemberRow;
  onClose: () => void;
  onSaved: () => void;
};

export function MemberDialog(props: CreateProps | EditProps) {
  if (props.mode === "create") return <CreateMemberDialog {...props} />;
  return <EditMemberDialog {...props} />;
}

function CreateMemberDialog({ leagueSlug, onCreated }: CreateProps) {
  const [open, setOpen] = useState(false);
  const [msrUid, setMsrUid] = useState("");
  const [role, setRole] = useState<MembershipRole>("ADMIN");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMsrUid("");
    setRole("ADMIN");
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
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msrUid: trimmed, role }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        setOpen(false);
        reset();
        onCreated();
      } else {
        setError((json["error"] as string) ?? "Add failed");
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
      <DialogTrigger render={<Button>Add member</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Grants (or updates) a league membership role for an MSR UID.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-msr-uid">MSR UID</Label>
            <Input
              id="member-msr-uid"
              value={msrUid}
              onChange={(e) => setMsrUid(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{MSR_UID_HELP}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MembershipRole)}>
              <SelectTrigger id="member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function EditMemberDialog({ leagueSlug, member, onClose, onSaved }: EditProps) {
  const [role, setRole] = useState<MembershipRole>(member.role);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (role === member.role) {
      onSaved();
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leagues/${leagueSlug}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msrUid: member.msrUid, role }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        onSaved();
      } else {
        // Surfaces the route's own message verbatim — including the 403
        // "you are this league's last ADMIN" refusal.
        setError((json["error"] as string) ?? "Update failed");
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
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{member.msrUid}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-member-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MembershipRole)}>
              <SelectTrigger id="edit-member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
