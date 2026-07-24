"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

type AccessGate = "required" | "optional" | "none";

const GATE_OPTIONS: { value: AccessGate; label: string }[] = [
  { value: "required", label: "Required — sign-in + membership gated" },
  { value: "optional", label: "Optional — public, with sign-in perks" },
  { value: "none", label: "None — fully public" },
];

export function CreateLeagueDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [gate, setGate] = useState<AccessGate>("optional");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSlug("");
    setName("");
    setGate("optional");
    setTitle("");
    setDescription("");
    setLogoUrl("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          gate,
          title: title.trim() ? title.trim() : undefined,
          description: description.trim() ? description.trim() : undefined,
          logoUrl: logoUrl.trim() ? logoUrl.trim() : undefined,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setPending(false);
        setOpen(false);
        reset();
        router.push(`/admin/leagues/${slug.trim()}`);
        router.refresh();
      } else {
        setError((json["error"] as string) ?? "Create failed");
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
      <DialogTrigger render={<Button>Create league</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create league</DialogTitle>
          <DialogDescription>
            Sets up a new League row plus a default scoring ruleset. You&apos;re auto-added as its
            admin.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="league-slug">Slug</Label>
            <Input
              id="league-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. pca-rmr"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="league-name">Name</Label>
            <Input
              id="league-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. PCA Rocky Mountain Region"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="league-gate">Access gate</Label>
            <Select value={gate} onValueChange={(v) => setGate(v as AccessGate)}>
              <SelectTrigger id="league-gate" className="w-full">
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
            <Label htmlFor="league-title">Site title (optional)</Label>
            <Input
              id="league-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to “Launch Control · <name>”"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="league-description">Site description (optional)</Label>
            <Input
              id="league-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="league-logo">Logo URL (optional)</Label>
            <Input
              id="league-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
            />
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
              {pending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
