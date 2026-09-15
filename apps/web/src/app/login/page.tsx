/**
 * /login — public sign-in page.
 *
 * Reads ?error= from the query string and shows contextual copy.
 * Renders a "Sign in with MotorsportReg" button that links to the
 * OAuth login route handler.
 *
 * That button is a plain <a>, NOT next/link: the target is a Route Handler
 * that 302s to MSR (cross-origin), so the App Router client would try to
 * fetch an RSC payload for it, fail on the cross-origin redirect, and fall
 * back to a browser navigation — running OAuth step 1 twice per click and
 * minting two request tokens. See also components/landing.tsx.
 */

import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sign in",
};

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Authorization was denied. Please try again.",
  "token-exchange": "There was a problem completing sign-in. Please try again.",
  "profile-fetch":
    "Signed in with MSR but could not load your profile. Please try again.",
};

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "An unexpected error occurred. Please try again.") : null;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Launch Control</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage && (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Use your MotorsportReg account to sign in. You do not need a
            separate password.
          </p>
          <a
            href="/api/auth/msr/login"
            className="inline-flex w-full items-center justify-center rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 h-8"
          >
            Sign in with MotorsportReg
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
