import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listLeagueDirectory } from "@/lib/league-directory";

export const dynamic = "force-dynamic";

/**
 * Public league directory (Task 5) — every league hosted on this deployment.
 * Always public: this page carries no gated content, only names/links; the
 * league CONTENT behind each link still respects that league's own gate.
 */
export default async function LeaguesPage() {
  const leagues = await listLeagueDirectory();

  return (
    <main className="w-full mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary mb-3">
          Directory
        </p>
        <div className="flex items-start gap-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Leagues
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Every league hosted on this Launch Control deployment.
            </p>
          </div>
        </div>
      </header>

      {leagues.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card shadow-sm px-6 py-12">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground">No leagues configured yet.</p>
        </div>
      ) : (
        <section className="rounded-3xl border border-border/70 bg-muted/20 p-3 shadow-sm">
          <ul className="space-y-3">
            {leagues.map((league) => (
              <li key={league.slug}>
                <Card className="group relative border border-border/70 bg-background/95 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background hover:shadow-md">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground mb-1">
                        {league.siteTitle}
                      </p>
                      <CardTitle className="group-hover:text-primary transition-colors">
                        <Link
                          href={`/l/${league.slug}`}
                          className="after:content-[''] after:absolute after:inset-0"
                        >
                          {league.name}
                        </Link>
                      </CardTitle>
                    </div>
                    <div className="relative z-10 flex flex-col items-end gap-2 shrink-0">
                      {league.activeSeasonName && (
                        <Badge variant="secondary">{league.activeSeasonName}</Badge>
                      )}
                      <Badge variant="outline">{league.eventCount} events</Badge>
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
