import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { countLeagues, getLeagueConfig, getLeagueConfigForSlug, resolveLeague } from "@/lib/league-config";

// getLeagueConfig() resolves branding/gate/smugmug config from the League row
// named by DEFAULT_LEAGUE_SLUG (default "pca-rmr"), replacing the archive's
// env-driven getClubConfig(). This suite runs against a fresh migrate+seed DB
// so the parity assertions pin the exact production strings the seed carries.

const TEST_DB_PATH = resolve(__dirname, "..", "test-league-config.db");
const TEST_DB_URL = "file:./test-league-config.db";

let prisma: PrismaClient;

// Env vars getLeagueConfig() reads. Snapshot + restore around every test so
// a developer's shell env (or a prior test) never leaks into another case.
const ENV_KEYS = [
  "DEFAULT_LEAGUE_SLUG",
  "MSR_ORG_ID",
  "MSR_RMR_ORG_ID",
  "MSR_CONSUMER_KEY",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("getLeagueConfig — default PCA league (parity)", () => {
  it("resolves the exact production branding strings with no env vars set", async () => {
    const config = await getLeagueConfig(prisma);
    expect(config.slug).toBe("pca-rmr");
    expect(config.name).toBe("PCA Rocky Mountain Region");
    expect(config.siteTitle).toBe("Launch Control · PCA RMR");
    expect(config.siteDescription).toBe(
      "Rocky Mountain Region autocross results, calendar, and community media.",
    );
    expect(config.footerText).toBe(
      "Built for PCA Rocky Mountain Region · Autocross results from VisualAX",
    );
    expect(config.landingDescription).toBe(
      "Sign in with your MotorsportReg account to access Rocky Mountain Region autocross results, sortable event leaderboards, season standings, and driver profiles.",
    );
    expect(config.accessGate).toBe("required");
    expect(config.msrOrgId).toBeNull();
    expect(config.smugmugUser).toBe("rmrpca");
    expect(config.smugmugDisciplinePath).toBe("Autocross");
  });

  it("disables login when MSR_CONSUMER_KEY is unset", async () => {
    const config = await getLeagueConfig(prisma);
    expect(config.loginEnabled).toBe(false);
  });

  it("enables login when MSR_CONSUMER_KEY is set and the gate isn't 'none'", async () => {
    process.env.MSR_CONSUMER_KEY = "some-key";
    const config = await getLeagueConfig(prisma);
    expect(config.loginEnabled).toBe(true);
  });

  it("resolves 'pca-rmr' by default when DEFAULT_LEAGUE_SLUG is unset", async () => {
    const config = await getLeagueConfig(prisma);
    expect(config.slug).toBe("pca-rmr");
  });
});

describe("getLeagueConfig — unknown slug", () => {
  it("throws a clear error for an unseeded DEFAULT_LEAGUE_SLUG", async () => {
    process.env.DEFAULT_LEAGUE_SLUG = "does-not-exist";
    await expect(getLeagueConfig(prisma)).rejects.toThrow(/does-not-exist/);
  });
});

describe("getLeagueConfig — msrOrgId env fallback during transition", () => {
  it("falls back to MSR_ORG_ID when the League row leaves msrOrgId unset", async () => {
    process.env.MSR_ORG_ID = "org-from-env";
    const config = await getLeagueConfig(prisma);
    expect(config.msrOrgId).toBe("org-from-env");
  });

  it("falls back to legacy MSR_RMR_ORG_ID when MSR_ORG_ID is unset", async () => {
    process.env.MSR_RMR_ORG_ID = "legacy-org-from-env";
    const config = await getLeagueConfig(prisma);
    expect(config.msrOrgId).toBe("legacy-org-from-env");
  });

  it("prefers the League row's msrOrgId over env vars once it is set", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "org-id-league",
        name: "Org Id League",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
        msrOrgId: "org-from-db",
      },
    });
    process.env.DEFAULT_LEAGUE_SLUG = "org-id-league";
    process.env.MSR_ORG_ID = "org-from-env";
    const config = await getLeagueConfig(prisma);
    expect(config.msrOrgId).toBe("org-from-db");
    await prisma.league.delete({ where: { id: league.id } });
  });
});

describe("getLeagueConfig — footerText NULL fallback", () => {
  it("resolves footerText to null when the League row's footerText is NULL", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "no-footer-league",
        name: "No Footer League",
        siteTitle: "x",
        siteDescription: "x",
        footerText: null,
        landingDescription: "x",
      },
    });
    process.env.DEFAULT_LEAGUE_SLUG = "no-footer-league";
    const config = await getLeagueConfig(prisma);
    // getLeagueConfig() passes footerText through verbatim (including null) —
    // the "Powered by Launch Control" fallback is a render-site concern
    // (app/layout.tsx), not a config-resolution concern, so a league that
    // never set its own footer text does not inherit another league's copy.
    expect(config.footerText).toBeNull();
    await prisma.league.delete({ where: { id: league.id } });
  });
});

describe("resolveLeague — Task 4 shared league-resolution rule", () => {
  it("with no slug, resolves the default league (DEFAULT_LEAGUE_SLUG)", async () => {
    const league = await resolveLeague(undefined, prisma);
    expect(league?.slug).toBe("pca-rmr");
  });

  it("respects DEFAULT_LEAGUE_SLUG when resolving with no slug", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "resolve-league-default-test",
        name: "x",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
      },
    });
    process.env.DEFAULT_LEAGUE_SLUG = "resolve-league-default-test";
    const resolved = await resolveLeague(undefined, prisma);
    expect(resolved?.id).toBe(league.id);
    await prisma.league.delete({ where: { id: league.id } });
  });

  it("with an explicit slug, resolves that league regardless of DEFAULT_LEAGUE_SLUG", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "resolve-league-explicit-test",
        name: "Explicit League",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
      },
    });
    // DEFAULT_LEAGUE_SLUG stays "pca-rmr" (unset) — the explicit slug wins.
    const resolved = await resolveLeague("resolve-league-explicit-test", prisma);
    expect(resolved?.id).toBe(league.id);
    await prisma.league.delete({ where: { id: league.id } });
  });

  it("returns null (never throws) for an unknown explicit slug", async () => {
    await expect(resolveLeague("no-such-league", prisma)).resolves.toBeNull();
  });

  it("returns null (never throws) when the default league is unseeded", async () => {
    process.env.DEFAULT_LEAGUE_SLUG = "does-not-exist";
    await expect(resolveLeague(undefined, prisma)).resolves.toBeNull();
  });
});

describe("getLeagueConfig — accessGate variants", () => {
  it("resolves a league seeded with accessGate 'optional'", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "public-league",
        name: "Public League",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
        accessGate: "optional",
      },
    });
    process.env.DEFAULT_LEAGUE_SLUG = "public-league";
    const config = await getLeagueConfig(prisma);
    expect(config.accessGate).toBe("optional");
    await prisma.league.delete({ where: { id: league.id } });
  });
});

// Task 5: /l/[league] routes resolve an ARBITRARY league by slug, not just
// DEFAULT_LEAGUE_SLUG — getLeagueConfigForSlug is the league-scoped
// counterpart to getLeagueConfig for that.
describe("getLeagueConfigForSlug — Task 5 arbitrary-league resolution", () => {
  it("resolves a non-default league's full config by slug", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "second-league",
        name: "Second League",
        siteTitle: "Launch Control · Second League",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
        accessGate: "optional",
        smugmugUser: "second-league-user",
        smugmugDisciplinePath: "Autocross",
      },
    });
    // DEFAULT_LEAGUE_SLUG stays "pca-rmr" (unset) — the explicit slug wins,
    // same rule as resolveLeague.
    const config = await getLeagueConfigForSlug("second-league", prisma);
    expect(config?.id).toBe(league.id);
    expect(config?.slug).toBe("second-league");
    expect(config?.name).toBe("Second League");
    expect(config?.accessGate).toBe("optional");
    expect(config?.smugmugUser).toBe("second-league-user");
    await prisma.league.delete({ where: { id: league.id } });
  });

  it("returns null (never throws) for an unknown slug", async () => {
    await expect(getLeagueConfigForSlug("no-such-league", prisma)).resolves.toBeNull();
  });

  it("still resolves the default league by its own slug (no special-casing)", async () => {
    const config = await getLeagueConfigForSlug("pca-rmr", prisma);
    expect(config?.slug).toBe("pca-rmr");
    expect(config?.name).toBe("PCA Rocky Mountain Region");
  });
});

// Final-review fix: toLeagueConfig is the single choke point every League row
// passes through, so this is where a non-default league configured with
// accessGate "required" is refused outright — a non-default "required" league
// would otherwise silently gate on the DEFAULT league's MSR membership (login
// is not per-league yet; PR 3 territory).
describe("toLeagueConfig (via getLeagueConfigForSlug/getLeagueConfig) — non-default 'required' guard", () => {
  it("throws a clear, league-naming error for a non-default league with accessGate 'required'", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "required-non-default",
        name: "Required Non Default",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
        accessGate: "required",
      },
    });
    await expect(getLeagueConfigForSlug("required-non-default", prisma)).rejects.toThrow(
      /required-non-default[\s\S]*only the default league[\s\S]*may use "required"/,
    );
    await prisma.league.delete({ where: { id: league.id } });
  });

  it("does not affect the default league's own accessGate 'required'", async () => {
    const config = await getLeagueConfig(prisma);
    expect(config.slug).toBe("pca-rmr");
    expect(config.accessGate).toBe("required");
  });

  it("does not affect a non-default league when it resolves as the DEFAULT_LEAGUE_SLUG target", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "required-as-default",
        name: "Required As Default",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
        accessGate: "required",
      },
    });
    process.env.DEFAULT_LEAGUE_SLUG = "required-as-default";
    const config = await getLeagueConfig(prisma);
    expect(config.slug).toBe("required-as-default");
    expect(config.accessGate).toBe("required");
    await prisma.league.delete({ where: { id: league.id } });
  });
});

// Task 5: header nav's "Leagues" link only renders when >1 league exists.
describe("countLeagues", () => {
  it("returns 1 for a fresh seed (only the default league)", async () => {
    expect(await countLeagues(prisma)).toBe(1);
  });

  it("increases as leagues are added", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "count-leagues-test",
        name: "x",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
      },
    });
    expect(await countLeagues(prisma)).toBe(2);
    await prisma.league.delete({ where: { id: league.id } });
  });
});
