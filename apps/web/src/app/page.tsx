import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function HomePage() {
  const events = await prisma.event.findMany({
    orderBy: { date: "desc" },
    include: { _count: { select: { entries: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">PCA Launch Control</h1>
        <p className="text-muted-foreground mt-2">
          Rocky Mountain Region · 2026 Autocross results
        </p>
      </header>

      {events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events ingested yet</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Run <code className="bg-muted rounded px-1.5 py-0.5">pnpm ingest &lt;path-to-axdb&gt;</code> from <code className="bg-muted rounded px-1.5 py-0.5">apps/web</code> to publish results.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/events/${event.slug}`} className="block">
                <Card className="hover:bg-accent/50 transition-colors">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle>{event.name}</CardTitle>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {formatDate(event.date)}
                      </p>
                    </div>
                    <Badge variant="secondary">{event._count.entries} entries</Badge>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
