/**
 * /login — public sign-in page.
 *
 * Reads ?error= from the query string and shows contextual copy.
 * Renders a "Sign in with MotorsportReg" button that links to the
 * OAuth login route handler.
 */

import type { Metadata } from "next";
import Link from "next/link";
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
          <Link
            href="/api/auth/msr/login"
            className="inline-flex w-full items-center justify-center rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 h-8"
          >
            Sign in with MotorsportReg
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
