"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Counts = { ingested: number; unchanged: number; skipped: number; failed: number };

export function IngestNowButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setCounts(null);
    try {
      const res = await fetch(`/api/admin/leagues/${slug}/ingest-now`, { method: "POST" });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setCounts(json as unknown as Counts);
        router.refresh();
      } else {
        setError((json["error"] as string) ?? "Ingest failed");
      }
    } catch {
      setError("Network error — could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={run} disabled={pending} className="self-start">
        {pending ? "Ingesting…" : "Ingest now"}
      </Button>
      {pending && (
        <p className="text-sm text-muted-foreground">
          Ingesting — this fetches PDFs politely and can take a minute.
        </p>
      )}
      {counts && (
        <p className="text-sm">
          Done — {counts.ingested} ingested, {counts.unchanged} unchanged, {counts.skipped} skipped
          {counts.failed > 0 ? `, ${counts.failed} failed` : ""}.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
