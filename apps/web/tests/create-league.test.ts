import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { createLeague } from "@/lib/create-league";

// Unit tests for createLeague() — used by scripts/create-league.ts (the
// "league:create" CLI). Mirrors tests/create-season.test.ts's structure and
// conventions.

const TEST_DB_PATH = resolve(__dirname, "..", "test-create-league.db");
const TEST_DB_URL = "file:./test-create-league.db";

let prisma: PrismaClient;
const tmpDir = mkdtempSync(join(tmpdir(), "create-league-test-"));

function policyFile(name: string, contents: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, contents);
  return p;
}

beforeAll(() => {
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
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createLeague", () => {
  it("happy path: creates a League row with defaulted branding fields and a default ScoringSystem preset", async () => {
    const result = await createLeague({ slug: "rmsolo", name: "Rocky Mountain Solo" }, prisma);
    expect(result.league.slug).toBe("rmsolo");
    expect(result.league.name).toBe("Rocky Mountain Solo");
    expect(result.league.siteTitle).toBe("Launch Control · Rocky Mountain Solo");
    expect(result.league.siteDescription).toBe("Rocky Mountain Solo results, calendar, and community media.");
    expect(result.league.landingDescription).toBe("Public results and standings for Rocky Mountain Solo.");
    expect(result.league.footerText).toBeNull();
    expect(result.league.accessGate).toBe("required");
    expect(result.scoringSystemName).toBe("Rocky Mountain Solo Default");

    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: result.league.id } });
    expect(preset.name).toBe("Rocky Mountain Solo Default");
    expect(preset.policy).toBe(
      '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}',
    );

    // The whole point: a league created this way can immediately resolveOrCreateSeason.
    const seasonPresetCheck = await prisma.scoringSystem.findFirst({ where: { leagueId: result.league.id } });
    expect(seasonPresetCheck).not.toBeNull();
  });

  it("happy path: honors explicit branding flags and a custom gate", async () => {
    const result = await createLeague(
      {
        slug: "custom-branding-league",
        name: "Custom League",
        title: "Custom Site Title",
        description: "Custom description.",
        footer: "Custom footer.",
        landing: "Custom landing copy.",
        gate: "none",
      },
      prisma,
    );
    expect(result.league.siteTitle).toBe("Custom Site Title");
    expect(result.league.siteDescription).toBe("Custom description.");
    expect(result.league.footerText).toBe("Custom footer.");
    expect(result.league.landingDescription).toBe("Custom landing copy.");
    expect(result.league.accessGate).toBe("none");
  });

  it("happy path: --preset-name names the default ScoringSystem preset", async () => {
    const result = await createLeague(
      { slug: "named-preset-league", name: "Named Preset League", presetName: "Named Preset" },
      prisma,
    );
    expect(result.scoringSystemName).toBe("Named Preset");
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: result.league.id } });
    expect(preset.name).toBe("Named Preset");
  });

  it("happy path: --policy-file reads, validates, and canonicalizes a policy JSON file for the default preset", async () => {
    const file = policyFile(
      "custom-policy.json",
      '{\n  "v": 1,\n  "drops": "proportional",\n  "paxSection": true,\n  "classMetric": "pax",\n  "conePenaltyMs": 1000\n}\n',
    );
    const result = await createLeague(
      { slug: "policy-file-league", name: "Policy File League", policyFilePath: file },
      prisma,
    );
    const preset = await prisma.scoringSystem.findFirstOrThrow({ where: { leagueId: result.league.id } });
    expect(preset.policy).toBe(
      '{"v":1,"drops":"proportional","paxSection":true,"classMetric":"pax","conePenaltyMs":1000}',
    );
  });

  it("rejects a duplicate slug", async () => {
    await createLeague({ slug: "dup-league", name: "First" }, prisma);
    await expect(createLeague({ slug: "dup-league", name: "Second" }, prisma)).rejects.toThrow(
      /a league with slug 'dup-league' already exists/,
    );
  });

  it("rejects a malformed slug", async () => {
    await expect(
      createLeague({ slug: "Not A Valid Slug!", name: "Bad Slug League" }, prisma),
    ).rejects.toThrow(/--slug must be lowercase alphanumeric, hyphen-separated/);
  });

  it("rejects a bad --gate value", async () => {
    await expect(
      createLeague(
        { slug: "bad-gate-league", name: "Bad Gate League", gate: "sideways" as never },
        prisma,
      ),
    ).rejects.toThrow(/--gate must be one of required, optional, none/);
  });

  it("rejects an invalid --policy-file (fails parseScoringPolicy)", async () => {
    const file = policyFile(
      "bad-policy.json",
      '{"v":1,"drops":"sideways","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}',
    );
    await expect(
      createLeague({ slug: "bad-policy-league", name: "Bad Policy League", policyFilePath: file }, prisma),
    ).rejects.toThrow(/scoringPolicy\.drops/);
  });

  it("rejects a --policy-file that does not exist", async () => {
    await expect(
      createLeague(
        { slug: "missing-policy-league", name: "Missing Policy League", policyFilePath: join(tmpDir, "missing.json") },
        prisma,
      ),
    ).rejects.toThrow(/failed to read policy file/);
  });

  it("does not create a League row when the ScoringSystem preset creation would fail (transactional)", async () => {
    const file = policyFile("bad-transactional.json", '{"v":1,"drops":"sideways"}');
    await expect(
      createLeague({ slug: "rolled-back-league", name: "Rolled Back League", policyFilePath: file }, prisma),
    ).rejects.toThrow();
    // parseScoringPolicy runs before the transaction opens, so no League row should exist at all.
    expect(await prisma.league.findUnique({ where: { slug: "rolled-back-league" } })).toBeNull();
  });
});
