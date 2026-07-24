import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { administeredLeagues } from "@/lib/admin";
import { isSuperUser } from "@/lib/super-user";
import { CreateLeagueDialog } from "./create-league-dialog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminPage() {
  const session = await getSession();
  const [leagues, canManageUsers] = await Promise.all([
    administeredLeagues(session.msrUid),
    isSuperUser(session.msrUid),
  ]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div>
          <h1 className="text-xl font-semibold">Admin</h1>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Leagues
            </h2>
            <CreateLeagueDialog />
          </div>
          <div className="flex flex-col gap-3">
            {leagues.map((league) => (
              <Link key={league.slug} href={`/admin/leagues/${league.slug}`}>
                <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="truncate">{league.name}</span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {league.slug}
                      </span>
                      <Badge variant="outline">{league.accessGate}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {leagues.length === 0 && (
              <p className="text-sm text-muted-foreground">
                You don&apos;t administer any leagues yet.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Platform
          </h2>
          <div className="flex flex-col gap-3">
            <Link href="/admin/ingest">
              <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Ingest .axdb
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Upload a post-event VisualAX .axdb file to publish results.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/admin/events">
              <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Manage events
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Edit event metadata or delete duplicate/bad events.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/admin/audit">
              <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Audit log
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Review admin ingest, edit, and delete history.
                  </p>
                </CardContent>
              </Card>
            </Link>
            {canManageUsers && (
              <Link href="/admin/users">
                <Card className="cursor-pointer hover:border-primary/40 transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      Users
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Every league&apos;s memberships, plus superuser grants.
                    </p>
                  </CardContent>
                </Card>
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
