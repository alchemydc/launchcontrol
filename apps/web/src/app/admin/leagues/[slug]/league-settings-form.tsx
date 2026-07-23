"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AccessGate = "required" | "optional" | "none";

export type LeagueSettings = {
  slug: string;
  name: string;
  siteTitle: string;
  siteDescription: string;
  footerText: string | null;
  landingDescription: string;
  accessGate: AccessGate;
  logoUrl: string | null;
  msrOrgId: string | null;
  smugmugUser: string | null;
  smugmugDisciplinePath: string | null;
};

const GATE_OPTIONS: { value: AccessGate; label: string }[] = [
  { value: "required", label: "Required — sign-in + membership gated" },
  { value: "optional", label: "Optional — public, with sign-in perks" },
  { value: "none", label: "None — fully public" },
];

/** Empty-string-as-null for the nullable text fields. */
function orNull(v: string): string | null {
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

export function LeagueSettingsForm({
  league,
  canDelete,
}: {
  league: LeagueSettings;
  canDelete: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState(league.name);
  const [siteTitle, setSiteTitle] = useState(league.siteTitle);
  const [siteDescription, setSiteDescription] = useState(league.siteDescription);
  const [footerText, setFooterText] = useState(league.footerText ?? "");
  const [landingDescription, setLandingDescription] = useState(league.landingDescription);
  const [accessGate, setAccessGate] = useState<AccessGate>(league.accessGate);
  const [logoUrl, setLogoUrl] = useState(league.logoUrl ?? "");
  const [msrOrgId, setMsrOrgId] = useState(league.msrOrgId ?? "");
  const [smugmugUser, setSmugmugUser] = useState(league.smugmugUser ?? "");
  const [smugmugDisciplinePath, setSmugmugDisciplinePath] = useState(
    league.smugmugDisciplinePath ?? "",
  );

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    // Only send fields that actually changed — the PATCH route treats an
    // absent key as "leave alone" (toPatch() in the route only copies keys
    // present in the body). Sending every field unconditionally would
    // re-validate untouched values on every save (e.g. `updateLeague`'s
    // strict http(s)-only `logoUrl` check) and could reject a save the user
    // never asked to make just because some legacy/grandfathered value in an
    // untouched field no longer passes validation.
    const patch: Record<string, string | null> = {};
    if (name !== league.name) patch.name = name;
    if (siteTitle !== league.siteTitle) patch.siteTitle = siteTitle;
    if (siteDescription !== league.siteDescription) patch.siteDescription = siteDescription;
    if (orNull(footerText) !== league.footerText) patch.footerText = orNull(footerText);
    if (landingDescription !== league.landingDescription) patch.landingDescription = landingDescription;
    if (accessGate !== league.accessGate) patch.accessGate = accessGate;
    if (orNull(logoUrl) !== league.logoUrl) patch.logoUrl = orNull(logoUrl);
    if (orNull(msrOrgId) !== league.msrOrgId) patch.msrOrgId = orNull(msrOrgId);
    if (orNull(smugmugUser) !== league.smugmugUser) patch.smugmugUser = orNull(smugmugUser);
    if (orNull(smugmugDisciplinePath) !== league.smugmugDisciplinePath) {
      patch.smugmugDisciplinePath = orNull(smugmugDisciplinePath);
    }

    if (Object.keys(patch).length === 0) {
      setPending(false);
      setSaved(true);
      return;
    }

    try {
      const res = await fetch(`/api/admin/leagues/${league.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        setSaved(true);
        router.refresh();
      } else {
        setError((json["error"] as string) ?? "Update failed");
        setPending(false);
      }
    } catch {
      setError("Network error — could not reach the server");
      setPending(false);
    }
  }

  async function handleDelete() {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/leagues/${league.slug}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      const json = (await res.json()) as Record<string, unknown>;
      setDeleteError((json["error"] as string) ?? "Delete failed");
      setDeletePending(false);
    } catch {
      setDeleteError("Network error — could not reach the server");
      setDeletePending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Branding, access gate, and integrations.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-name">Name</Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-site-title">Site title</Label>
              <Input
                id="settings-site-title"
                value={siteTitle}
                onChange={(e) => {
                  setSiteTitle(e.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-site-description">Site description</Label>
              <Textarea
                id="settings-site-description"
                value={siteDescription}
                onChange={(e) => {
                  setSiteDescription(e.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-landing-description">Landing description</Label>
              <Textarea
                id="settings-landing-description"
                value={landingDescription}
                onChange={(e) => {
                  setLandingDescription(e.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-footer-text">Footer text (optional)</Label>
              <Textarea
                id="settings-footer-text"
                value={footerText}
                onChange={(e) => {
                  setFooterText(e.target.value);
                  setSaved(false);
                }}
                placeholder="Leave blank for the platform default footer"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-gate">Access gate</Label>
              <Select
                value={accessGate}
                onValueChange={(v) => {
                  setAccessGate(v as AccessGate);
                  setSaved(false);
                }}
              >
                <SelectTrigger id="settings-gate" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GATE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-logo">Logo URL (optional)</Label>
              <Input
                id="settings-logo"
                value={logoUrl}
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  setSaved(false);
                }}
                placeholder="https://…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-msr-org">MSR org ID (optional)</Label>
              <Input
                id="settings-msr-org"
                value={msrOrgId}
                onChange={(e) => {
                  setMsrOrgId(e.target.value);
                  setSaved(false);
                }}
                placeholder="Used to auto-match members via MSR org membership"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-smugmug-user">SmugMug user (optional)</Label>
              <Input
                id="settings-smugmug-user"
                value={smugmugUser}
                onChange={(e) => {
                  setSmugmugUser(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-smugmug-path">SmugMug discipline path (optional)</Label>
              <Input
                id="settings-smugmug-path"
                value={smugmugDisciplinePath}
                onChange={(e) => {
                  setSmugmugDisciplinePath(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && !error && (
              <p className="text-sm text-muted-foreground">Saved.</p>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {canDelete && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Deleting a league removes its seasons and scoring presets. Refuses if the league
              still has events — delete those first.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete league
            </Button>
          </CardFooter>
        </Card>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deletePending) return;
          setDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {league.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the league&apos;s seasons and scoring presets. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deletePending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deletePending}>
              {deletePending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
