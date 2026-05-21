import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { findSmugmugEventFolder } from "@/lib/smugmug";

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

  const photosUrls = await Promise.all(
    events.map((e) => findSmugmugEventFolder(e.name, e.date))
  );

  const currentYear = events[0]?.date.getFullYear() ?? new Date().getFullYear();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          {currentYear} Season
        </p>
        <div className="flex items-start gap-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Event results</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Rocky Mountain Region autocross results, sorted by most recent event.
            </p>
          </div>
        </div>
      </header>

      {events.length === 0 ? (
        <Card className="border border-border/70 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>No events ingested yet</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Run <code className="bg-muted rounded px-1.5 py-0.5">pnpm ingest &lt;path-to-axdb&gt;</code> from <code className="bg-muted rounded px-1.5 py-0.5">apps/web</code> to publish results.
          </CardContent>
        </Card>
      ) : (
        <section className="rounded-3xl border border-border/70 bg-muted/20 p-3 shadow-sm">
          <ul className="space-y-3">
            {events.map((event, i) => (
              <li key={event.id}>
                <Card className="group relative border border-border/70 bg-background/95 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:shadow-md">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="group-hover:text-primary transition-colors">
                        <Link
                          href={`/events/${event.slug}`}
                          className="after:content-[''] after:absolute after:inset-0"
                        >
                          {event.name}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(event.date)}
                      </p>
                    </div>
                    <div className="relative z-10 flex items-center gap-3 shrink-0">
                      {photosUrls[i] && (
                        <a
                          href={photosUrls[i]!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-sm"
                        >
                          Photos ↗
                        </a>
                      )}
                      <Badge variant="secondary">
                        {event._count.entries} entries
                      </Badge>
                    </div>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
