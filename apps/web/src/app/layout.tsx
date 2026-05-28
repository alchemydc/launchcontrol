import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { HeaderNav } from "@/components/header-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Launch Control · PCA RMR", template: "%s · Launch Control" },
  description:
    "Rocky Mountain Region autocross results, calendar, and community media.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
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
          Built for PCA Rocky Mountain Region · Autocross results from VisualAX
        </footer>
      </body>
    </html>
  );
}
