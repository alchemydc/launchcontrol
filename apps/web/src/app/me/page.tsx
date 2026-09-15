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
import { getLeagueConfig, getLeagueConfigForSlug, type LeagueConfig } from "@/lib/league-config";
import { checkLeagueAccess } from "@/lib/session";
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
 * The driver's leagues, narrowed to the ones THIS session may actually open.
 *
 * `/me` carries no league gate of its own, so without this the card would
 * summarize events from a league whose own stats route would redirect the
 * viewer — showing a count they cannot click through to. `checkLeagueAccess`
 * short-circuits to "allow" for non-required gates with no session or DB
 * read, so the common case costs nothing.
 */
async function accessibleLeagues(
  driverSeasons: Array<{ leagueId: number; leagueSlug: string }>,
): Promise<LeagueConfig[]> {
  const slugs = Array.from(new Set(driverSeasons.map((s) => s.leagueSlug)));
  const configs = await Promise.all(slugs.map((slug) => getLeagueConfigForSlug(slug)));
  const decisions = await Promise.all(
    configs.map((c) => (c ? checkLeagueAccess(c) : Promise.resolve("deny" as const))),
  );
  return configs.filter((c, i): c is LeagueConfig => c != null && decisions[i] === "allow");
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

  const [driverSeasons, defaultLeague] = await Promise.all([
    listSeasonsForDriver(self.driverId),
    getLeagueConfig(),
  ]);
  const allowed = await accessibleLeagues(driverSeasons);

  if (allowed.length === 0) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          {driverSeasons.length === 0
            ? "No event results yet — your stats page will fill in after your first event."
            : "Your results are in leagues you don't currently have access to."}
        </p>
      </Section>
    );
  }

  // `/drivers/[id]` gates on the DEPLOYMENT default league, so it is the only
  // cross-league destination and it is unreachable without access to that
  // league. When it is out of reach there is no route that spans several
  // leagues, so pin BOTH the summary and the link to one league rather than
  // summarizing events the link can't show.
  const hasDefault = allowed.some((l) => l.slug === defaultLeague.slug);
  const scope = hasDefault ? allowed : allowed.slice(0, 1);

  const history = await buildDriverHistory(self.driverId, {
    leagueIds: scope.map((l) => l.id),
  });

  // Same "best finish" definition the driver page uses: only events where the
  // driver actually posted a scoring position count.
  const cleanRows = history.filter((r) => r.position != null);
  const bestPosition =
    cleanRows.length === 0
      ? null
      : Math.min(...cleanRows.map((r) => r.position as number));

  const href = hasDefault
    ? scope.length > 1
      ? `/drivers/${self.driverId}?league=all`
      : `/drivers/${self.driverId}`
    : `/l/${scope[0]!.slug}/drivers/${self.driverId}`;

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
