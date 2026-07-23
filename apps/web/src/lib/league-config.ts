/**
 * League configuration — every deployment-specific behavior (branding, the
 * MSR access gate, SmugMug lookup) is resolved from the League row named by
 * DEFAULT_LEAGUE_SLUG, not from env vars. PR 1 is single-league-per-deployment:
 * DEFAULT_LEAGUE_SLUG (default "pca-rmr") is the only tenant-selecting env var.
 *
 * Defaults reproduce the original PCA RMR deployment byte-for-byte (the
 * upstream-compatibility contract) via the seeded `pca-rmr` League row.
 */

import { cache } from "react";
import type { League, PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";

export type AccessGate = "required" | "optional" | "none";

export type LeagueConfig = {
  slug: string;
  name: string;
  siteTitle: string;
  siteDescription: string;
  /** Nullable — callers render this verbatim when set; the generic platform
   *  fallback ("Powered by Launch Control") is applied at the render site
   *  (app/layout.tsx), not here, so a league with no footerText never
   *  inherits another league's copy. */
  footerText: string | null;
  landingDescription: string;
  /** required: session+org membership gates results (PCA). optional: public results, login offered. none: public, no login UI. */
  accessGate: AccessGate;
  /** MSR org UUID for membership display/gating. League.msrOrgId wins;
   *  MSR_ORG_ID/MSR_RMR_ORG_ID (legacy alias) are honored as a fallback only
   *  while leagues are transitioning off env-based org config. */
  msrOrgId: string | null;
  /** Login UI renders only when MSR credentials exist and the gate allows sign-in. */
  loginEnabled: boolean;
  /** SmugMug photo-album lookup target. League row is authoritative;
   *  SMUGMUG_USER/SMUGMUG_DISCIPLINE_PATH env vars are honored as a fallback
   *  only when the League row leaves the field unset (null). */
  smugmugUser: string | null;
  smugmugDisciplinePath: string | null;
};

const ACCESS_GATES = ["required", "optional", "none"] as const;

function coerceAccessGate(raw: string): AccessGate {
  return (ACCESS_GATES as readonly string[]).includes(raw)
    ? (raw as AccessGate)
    : "required";
}

function defaultLeagueSlug(): string {
  return process.env.DEFAULT_LEAGUE_SLUG?.trim() || "pca-rmr";
}

/**
 * Resolve the raw League row named by DEFAULT_LEAGUE_SLUG (default
 * "pca-rmr"), or `null` if it doesn't exist. Shared by `getLeagueConfig`
 * (which throws a friendly error on `null`, below) and callers that just
 * need the row/id and already handle an absent league gracefully —
 * `season-leaderboard.ts`'s scoping lookups and the admin membership shim.
 * Not memoized like `getLeagueConfig`: callers needing per-request dedup
 * inside a React render tree should go through `getLeagueConfig` instead.
 */
export async function resolveDefaultLeague(
  client: PrismaClient = defaultClient,
): Promise<League | null> {
  return client.league.findUnique({ where: { slug: defaultLeagueSlug() } });
}

async function loadLeagueConfig(client: PrismaClient): Promise<LeagueConfig> {
  const league = await resolveDefaultLeague(client);
  if (!league) {
    throw new Error(
      `[league-config] no League row for DEFAULT_LEAGUE_SLUG=${JSON.stringify(defaultLeagueSlug())} — run 'prisma migrate deploy' to seed it.`,
    );
  }

  const accessGate = coerceAccessGate(league.accessGate);
  const msrOrgId =
    league.msrOrgId || process.env.MSR_ORG_ID || process.env.MSR_RMR_ORG_ID || null;

  return {
    slug: league.slug,
    name: league.name,
    siteTitle: league.siteTitle,
    siteDescription: league.siteDescription,
    footerText: league.footerText,
    landingDescription: league.landingDescription,
    accessGate,
    msrOrgId,
    loginEnabled: Boolean(process.env.MSR_CONSUMER_KEY) && accessGate !== "none",
    smugmugUser: league.smugmugUser,
    smugmugDisciplinePath: league.smugmugDisciplinePath,
  };
}

/**
 * Resolves the deployment's LeagueConfig, memoized per-request via React
 * `cache()` so every Server Component in a render tree that calls
 * `getLeagueConfig()` with no argument shares one DB read. Pass an explicit
 * `client` (tests, scripts) to bypass the shared prisma singleton — distinct
 * client arguments get their own cache entry.
 */
export const getLeagueConfig = cache(
  (client: PrismaClient = defaultClient): Promise<LeagueConfig> =>
    loadLeagueConfig(client),
);
