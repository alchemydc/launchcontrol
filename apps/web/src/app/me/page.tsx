/**
 * /me — authenticated user profile page.
 *
 * Reads session via getSession(). Redirects to /login if not signed in.
 * Renders first name + last initial, MSR UID, RMR membership badge, a
 * "My results" card linking to this viewer's own driver stats page, and a
 * logout form. The cookie is the source of truth for identity — no live MSR
 * re-fetch — but the results card does hit the DB to resolve the Driver row.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveSelfDriver } from "@/lib/driver-self";
import { buildDriverHistory, listSeasonsForDriver } from "@/lib/driver-history";
import { getLeagueConfig } from "@/lib/league-config";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CloseButton } from "@/components/close-button";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Profile",
};

export const dynamic = "force-dynamic";

/**
 * Where "View my full stats" points.
 *
 * `/drivers/[id]` gates on the DEPLOYMENT's default league (requireRmrMember),
 * so a viewer whose results live only in another league would bounce off it.
 * When none of their leagues is the default one, send them to that league's
 * own scoped route instead, which gates on the league that actually holds
 * their results. Otherwise use the legacy route, widened to every league via
 * `?league=all` when they've run in more than one (the driver page's own
 * filter already understands that param).
 */
function statsHref(
  driverId: number,
  leagueSlugs: string[],
  defaultLeagueSlug: string,
): string {
  if (leagueSlugs.length > 0 && !leagueSlugs.includes(defaultLeagueSlug)) {
    return `/l/${leagueSlugs[0]}/drivers/${driverId}`;
  }
  return leagueSlugs.length > 1
    ? `/drivers/${driverId}?league=all`
    : `/drivers/${driverId}`;
}

export default async function MePage() {
  const session = await getSession();

  if (!session.msrUid) {
    redirect("/login");
  }

  const displayName = `${session.firstName ?? ""} ${session.lastInitial ?? ""}`.trim();
  const self = await resolveSelfDriver(session);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{displayName}</CardTitle>
          <CardAction>
            <CloseButton fallbackHref="/" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            {session.isRmrMember ? (
              <Badge variant="success">RMR member</Badge>
            ) : (
              <Badge variant="outline">Non-member</Badge>
            )}
          </div>

          <MyResults self={self} />

          <p className="text-xs text-muted-foreground break-all">
            MSR UID: {session.msrUid}
          </p>
        </CardContent>
        <CardFooter>
          <form method="post" action="/api/auth/logout" className="w-full">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}

/**
 * "My results" section. Split out so the three states read as one branch each
 * rather than as nested ternaries inside the card.
 */
async function MyResults({
  self,
}: {
  self: Awaited<ReturnType<typeof resolveSelfDriver>>;
}) {
  if (self.status === "unlinkable") {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          Sign out and back in to link your event results to your profile.
        </p>
      </Section>
    );
  }

  if (self.status === "unmatched") {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          We haven&apos;t matched you to any event results yet. This usually means the
          name on the results differs from your MSR profile — ask an event admin to
          link them up.
        </p>
      </Section>
    );
  }

  // These three reads don't depend on each other; against Turso each is a
  // network round trip, so issue them together.
  const [driverSeasons, history, defaultLeague] = await Promise.all([
    listSeasonsForDriver(self.driverId),
    buildDriverHistory(self.driverId, { leagueIds: "all" }),
    getLeagueConfig(),
  ]);

  // Same "best finish" definition the driver page uses: only events where the
  // driver actually posted a scoring position count.
  const cleanRows = history.filter((r) => r.position != null);
  const bestPosition =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.position as number));

  const leagueSlugs = Array.from(new Set(driverSeasons.map((s) => s.leagueSlug)));
  const href = statsHref(self.driverId, leagueSlugs, defaultLeague.slug);

  return (
    <Section>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No event results yet — your stats page will fill in after your first event.
        </p>
      ) : (
        <p className="text-sm text-foreground">
          <span className="font-semibold tabular-nums">{history.length}</span>{" "}
          {history.length === 1 ? "event" : "events"}
          {bestPosition != null && (
            <>
              {" · best finish "}
              <span className="font-semibold tabular-nums">{bestPosition}</span>
            </>
          )}
        </p>
      )}
      <Link
        href={href}
        className={cn(buttonVariants({ variant: "default" }), "mt-2 w-full")}
      >
        View my full stats →
      </Link>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-border/70 bg-muted/30 px-3 py-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase mb-2">
        My results
      </p>
      {children}
    </div>
  );
}
