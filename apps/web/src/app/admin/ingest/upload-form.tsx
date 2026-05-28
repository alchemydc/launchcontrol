"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type State = "idle" | "uploading" | "done";

type IngestResult =
  | {
      ok: true;
      status: "ingested" | "unchanged";
      event: { id: number; slug: string; name: string };
      counts: { classes: number; drivers: number; entries: number; runs: number };
    }
  | { ok: false; error: string };

export function UploadForm() {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<IngestResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setState("uploading");
    setResult(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch("/api/admin/ingest", { method: "POST", body });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setResult({
          ok: true,
          status: json["status"] as "ingested" | "unchanged",
          event: json["event"] as { id: number; slug: string; name: string },
          counts: json["counts"] as { classes: number; drivers: number; entries: number; runs: number },
        });
      } else {
        setResult({ ok: false, error: (json["error"] as string) ?? "Unknown error" });
      }
    } catch {
      setResult({ ok: false, error: "Network error — could not reach the server" });
    } finally {
      setState("done");
    }
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Ingest .axdb</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input type="file" name="file" accept=".axdb" required />
            <Button type="submit" disabled={state === "uploading"}>
              {state === "uploading" ? "Uploading..." : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {result.ok ? (
              <>
                {result.status === "unchanged" && (
                  <Badge variant="outline">Re-uploaded — no changes</Badge>
                )}
                <p className="text-sm font-medium">
                  <Link href={`/events/${result.event.slug}`} className="underline underline-offset-4 hover:text-primary">
                    {result.event.name}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">Slug: {result.event.slug}</p>
                <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
                  <li>Classes: {result.counts.classes}</li>
                  <li>Drivers: {result.counts.drivers}</li>
                  <li>Entries: {result.counts.entries}</li>
                  <li>Runs: {result.counts.runs}</li>
                </ul>
              </>
            ) : (
              <p className="text-sm text-destructive">{result.error}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
