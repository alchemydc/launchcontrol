/**
 * Shared classing-guide body, rendered by both `/l/[league]/classing` and the
 * legacy `/classing` alias — the same split `EventPageView` uses, so the two
 * routes can never drift.
 *
 * Deliberately UNGATED, unlike every results page: a classing table is a
 * published rulebook with no PII and no results in it, and it is exactly what
 * someone deciding whether to come out to an event needs to read first. Its
 * upstream is a public page on the club's own site.
 *
 * One season at a time, driven by the subnav's season switcher. The upstream
 * generator instead solves for a minimal set of "season span" columns
 * (2024 | 2025-2026); with real Season rows and a switcher already in the
 * chrome, that whole search disappears and the page gains a season control
 * consistent with the rest of the app.
 */

import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { classingForSeason } from "@/lib/classing";
import { getClassingModel } from "@/lib/classing-registry";
import { prisma } from "@/lib/prisma";
import { listSeasonsForLeague, pickActiveSeason, pickSeasonBySlug } from "@/lib/season-resolve";
import { ClassingLookup } from "./classing-lookup";

export async function ClassingPageView({
  league,
  seasonSlug,
}: {
  league: { id: number; slug: string; name: string };
  /** From `?season=`; falls back to the league's active season. */
  seasonSlug?: string;
}) {
  // A league with no classing model has no classing page at all — the rules
  // are league-specific, so there is nothing sensible to show.
  const model = getClassingModel(league.slug);
  if (!model) notFound();

  const seasons = await listSeasonsForLeague(prisma, league.id);
  // Same resolution order the subnav's switcher uses, so the control and the
  // page always agree on which season is being shown.
  const season =
    (seasonSlug ? pickSeasonBySlug(seasons, seasonSlug) : null) ??
    pickActiveSeason(seasons) ??
    seasons[0];
  if (!season) notFound();

  const sections = classingForSeason(model, season.year);

  return (
    <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
          {season.name}
        </p>
        <div className="mt-3 flex items-start gap-4 min-w-0">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Vehicle classification
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Which class each car runs in for {model.organization} {model.eventType.toLowerCase()}.
            </p>
          </div>
        </div>
      </header>

      {sections.length === 0 ? (
        <section className="rounded-2xl border border-border/70 bg-card p-6 text-sm text-muted-foreground shadow-sm">
          The classing model has no entries for {season.year} yet. Pick another season above, or
          check back once the {season.year} rules are published.
        </section>
      ) : (
        <>
          <ClassingLookup model={model} season={season.year} seasonLabel={season.name} />

          <section className="mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
            <div className="bg-muted/40 px-4 py-3 border-b border-border/60">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                All classes · {season.name}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 w-20">Class</TableHead>
                    <TableHead className="px-4">Vehicles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map((section) => (
                    // Anchor target for the class badges' "Full classing guide →".
                    <TableRow key={section.classCode} id={section.classCode} className="scroll-mt-24">
                      <TableCell className="px-4 align-top">
                        <Badge variant="outline">{section.classCode}</Badge>
                      </TableCell>
                      <TableCell className="px-4 align-top">
                        <ul className="space-y-1.5">
                          {section.vehicles.map((vehicle) => (
                            <li
                              key={`${vehicle.title} ${vehicle.years}`}
                              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                            >
                              <span className="font-medium">{vehicle.title}</span>
                              {vehicle.trims.map((t) => (
                                <Badge key={t.name} variant="secondary" className="text-[10px]">
                                  {t.displacementMax ? `${t.name} · max ${t.displacementMax}` : t.name}
                                </Badge>
                              ))}
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {vehicle.years}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Classing model for {league.name}, last updated {model.generatedAt}. Organizers have the
        final say — if your car sits on a boundary, ask before you register.
      </p>
    </main>
  );
}
