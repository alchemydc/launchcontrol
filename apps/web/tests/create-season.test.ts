import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createSeason } from "@/lib/create-season";
import { slugify } from "@/lib/ingest";

// Unit tests for the core `createSeason()` used by both `scripts/create-season.ts`
// (the "season:create" CLI) and, indirectly, documents the same resolution rules
// ingestAxdb's auto-create path follows (see tests/ingest-season-policy.test.ts).

const PCA_POLICY = '{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}';

const TEST_DB_PATH = resolve(__dirname, "..", "test-create-season.db");
const TEST_DB_URL = "file:./test-create-season.db";

let prisma: PrismaClient;
let leagueId: number;
const tmpDir = mkdtempSync(join(tmpdir(), "create-season-test-"));

function policyFile(name: string, contents: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, contents);
  return p;
}

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
  leagueId = league.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSeason", () => {
  it("happy path: default preset (no --preset/--policy-file) uses the league's oldest ScoringSystem", async () => {
    const season = await createSeason(
      { leagueSlug: "pca-rmr", name: "2030 Default Preset Season", year: 2030 },
      prisma,
    );
    expect(season.leagueId).toBe(leagueId);
    expect(season.name).toBe("2030 Default Preset Season");
    expect(season.year).toBe(2030);
    expect(season.plannedEvents).toBe(0);
    expect(season.scoringPolicy).toBe(PCA_POLICY);
    expect(season.paxTable).toBe("{}");
    expect(season.status).toBe("active");
  });

  it("happy path: --preset resolves a named ScoringSystem", async () => {
    const season = await createSeason(
      {
        leagueSlug: "pca-rmr",
        name: "2041 Named Preset Season",
        year: 2041,
        plannedEvents: 8,
        presetName: "PCA Classic",
      },
      prisma,
    );
    expect(season.plannedEvents).toBe(8);
    expect(season.scoringPolicy).toBe(PCA_POLICY);
  });

  it("happy path: --policy-file reads, validates, and canonicalizes a policy JSON file", async () => {
    // Deliberately messy formatting/whitespace — should still canonicalize to
    // the same shape parseScoringPolicy produces.
    const file = policyFile(
      "rmsolo.json",
      '{\n  "v": 2,\n  "drops": "proportional",\n  "paxSection": true,\n  "conePenaltyMs": 2000\n}\n',
    );
    const season = await createSeason(
      { leagueSlug: "pca-rmr", name: "2031 File Policy Season", year: 2031, policyFilePath: file },
      prisma,
    );
    expect(season.scoringPolicy).toBe(
      '{"v":2,"drops":"proportional","paxSection":true,"conePenaltyMs":2000}',
    );
  });

  it("rejects a duplicate (leagueId, name) season", async () => {
    await createSeason({ leagueSlug: "pca-rmr", name: "2032 Dup Season", year: 2032 }, prisma);
    await expect(
      createSeason({ leagueSlug: "pca-rmr", name: "2032 Dup Season", year: 2032 }, prisma),
    ).rejects.toThrow(/already has a season named '2032 Dup Season'/);
  });

  it("allows multiple seasons for the same (league, year), addressed by distinct slugs", async () => {
    const first = await createSeason(
      { leagueSlug: "pca-rmr", name: "2040 First Season", year: 2040 },
      prisma,
    );
    const second = await createSeason(
      { leagueSlug: "pca-rmr", name: "2040 Winter Series", year: 2040 },
      prisma,
    );
    expect(first.year).toBe(2040);
    expect(second.year).toBe(2040);
    expect(first.slug).toBe("2040-first-season");
    expect(second.slug).toBe("2040-winter-series");
    expect(first.id).not.toBe(second.id);
  });

  it("defaults slug to slugify(name) when --slug is not given", async () => {
    const season = await createSeason(
      { leagueSlug: "pca-rmr", name: "2042 Spring Classic", year: 2042 },
      prisma,
    );
    expect(season.slug).toBe(slugify("2042 Spring Classic"));
    expect(season.slug).toBe("2042-spring-classic");
  });

  it("honors an explicit --slug override", async () => {
    const season = await createSeason(
      { leagueSlug: "pca-rmr", name: "2043 Custom Slug Season", year: 2043, slug: "custom-2043" },
      prisma,
    );
    expect(season.slug).toBe("custom-2043");
  });

  it("rejects a duplicate (leagueId, slug) season", async () => {
    await createSeason(
      { leagueSlug: "pca-rmr", name: "2044 First", year: 2044, slug: "dup-slug-2044" },
      prisma,
    );
    await expect(
      createSeason(
        { leagueSlug: "pca-rmr", name: "2045 Second", year: 2045, slug: "dup-slug-2044" },
        prisma,
      ),
    ).rejects.toThrow(/already has a season with slug 'dup-slug-2044'/);
  });

  it("rejects a malformed --slug", async () => {
    await expect(
      createSeason(
        { leagueSlug: "pca-rmr", name: "2046 Bad Slug", year: 2046, slug: "Not A Valid Slug!" },
        prisma,
      ),
    ).rejects.toThrow(/--slug must be lowercase alphanumeric, hyphen-separated/);
  });

  it("rejects an unknown league", async () => {
    await expect(
      createSeason({ leagueSlug: "does-not-exist", name: "x", year: 2033 }, prisma),
    ).rejects.toThrow(/unknown league 'does-not-exist'/);
  });

  it("rejects an unknown --preset name", async () => {
    await expect(
      createSeason(
        { leagueSlug: "pca-rmr", name: "2034 Unknown Preset", year: 2034, presetName: "Nonexistent Preset" },
        prisma,
      ),
    ).rejects.toThrow(/no scoring system preset named 'Nonexistent Preset'/);
  });

  it("rejects an invalid --policy-file (fails parseScoringPolicy)", async () => {
    const file = policyFile("bad.json", '{"v":2,"drops":"sideways","paxSection":false,"conePenaltyMs":2000}');
    await expect(
      createSeason({ leagueSlug: "pca-rmr", name: "2035 Bad Policy", year: 2035, policyFilePath: file }, prisma),
    ).rejects.toThrow(/scoringPolicy\.drops/);
  });

  it("rejects a --policy-file that does not exist", async () => {
    await expect(
      createSeason(
        { leagueSlug: "pca-rmr", name: "2036 Missing File", year: 2036, policyFilePath: join(tmpDir, "missing.json") },
        prisma,
      ),
    ).rejects.toThrow(/failed to read policy file/);
  });

  it("rejects specifying both --preset and --policy-file", async () => {
    const file = policyFile("both.json", PCA_POLICY);
    await expect(
      createSeason(
        {
          leagueSlug: "pca-rmr",
          name: "2037 Both",
          year: 2037,
          presetName: "PCA Classic",
          policyFilePath: file,
        },
        prisma,
      ),
    ).rejects.toThrow(/at most one of --preset or --policy-file/);
  });

  it("rejects a league with no ScoringSystem presets when no preset/policy-file is given", async () => {
    const bareLeague = await prisma.league.create({
      data: {
        slug: "bare-league",
        name: "Bare League",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    await expect(
      createSeason({ leagueSlug: bareLeague.slug, name: "2038 No Preset", year: 2038 }, prisma),
    ).rejects.toThrow(/has no scoring system presets — create one first/);
  });
});
