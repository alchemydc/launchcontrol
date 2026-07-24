import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { HeaderNav } from "@/components/header-nav";
import { getLeagueConfig } from "@/lib/league-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The root layout resolves branding from the DB on every request (via
// getLeagueConfig()). Force dynamic rendering for the whole tree so Next
// never tries to statically prerender routes like /_not-found against a
// build-time DB connection that may not exist yet (e.g. a fresh checkout
// before `prisma migrate deploy`).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const league = await getLeagueConfig();
  return {
    title: { default: league.siteTitle, template: "%s · Launch Control" },
    description: league.siteDescription,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const league = await getLeagueConfig();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="text-base font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
                Launch Control
              </span>
            </Link>
            <HeaderNav />
          </div>
        </header>

        {children}

        <footer className="mt-auto border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
          {league.footerText ?? "Powered by Launch Control"}
        </footer>
      </body>
    </html>
  );
}
