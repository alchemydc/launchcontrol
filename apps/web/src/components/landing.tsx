import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getLeagueConfig, type LeagueConfig } from "@/lib/league-config";

interface LandingProps {
  signedIn: boolean;
  returnTo: string | null;
  /** Omitted → the deployment's default league (pre-Task-5 behavior,
   *  byte-identical); `/l/[league]` passes that league's config so the
   *  landing copy reflects the league actually being viewed. */
  league?: Pick<LeagueConfig, "landingDescription">;
}

export async function Landing({ signedIn, returnTo, league: leagueProp }: LandingProps) {
  const league = leagueProp ?? (await getLeagueConfig());
  const loginHref = returnTo
    ? `/api/auth/msr/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/msr/login";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Image
            src="/launchcontrol-badge.png"
            alt="Launch Control — PCA Rocky Mountain Region autocross"
            width={480}
            height={480}
            priority
            className="h-auto w-48 drop-shadow-lg"
          />
        </div>
        <div className="flex items-start gap-4">
          <div className="h-8 w-0.5 bg-primary rounded-full shrink-0 mt-1" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Launch Control
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {league.landingDescription}
            </p>
          </div>
        </div>

        <a href={loginHref}>
          <Button className="w-full">Sign in with MotorsportReg</Button>
        </a>

        {signedIn && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your MotorsportReg account isn&apos;t a member of RMR. Event
              results are restricted to RMR members.
            </p>
            <form method="post" action="/api/auth/logout">
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
