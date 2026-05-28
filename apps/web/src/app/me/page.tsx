/**
 * /me — authenticated user profile page.
 *
 * Reads session via getSession(). Redirects to /login if not signed in.
 * Renders first name + last initial, MSR UID, RMR membership badge, and a
 * logout form. The cookie is the source of truth — no live MSR re-fetch in MVP.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CloseButton } from "@/components/close-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "My Profile",
};

export default async function MePage() {
  const session = await getSession();

  if (!session.msrUid) {
    redirect("/login");
  }

  const displayName = `${session.firstName ?? ""} ${session.lastInitial ?? ""}`.trim();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{displayName}</CardTitle>
          <CardAction>
            <CloseButton fallbackHref="/" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {session.isRmrMember ? (
              <Badge variant="success">RMR member</Badge>
            ) : (
              <Badge variant="outline">Non-member</Badge>
            )}
          </div>
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
