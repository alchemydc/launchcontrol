import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { listLeagueDirectory } from "@/lib/league-directory";

// Task 5: /leagues public directory data fn — every League row, its active
// season's name (per season-resolve.ts's activeSeason), and that season's
// event count.

const TEST_DB_PATH = resolve(__dirname, "..", "test-league-directory.db");
const TEST_DB_URL = "file:./test-league-directory.db";
const PCA_POLICY = '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';

let prisma: PrismaClient;

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

describe("listLeagueDirectory", () => {
  it("lists the seeded default league with no active season yet", async () => {
    const directory = await listLeagueDirectory(prisma);
    const pca = directory.find((l) => l.slug === "pca-rmr");
    expect(pca).toBeDefined();
    expect(pca?.name).toBe("PCA Rocky Mountain Region");
    expect(pca?.activeSeasonName).toBeNull();
    expect(pca?.eventCount).toBe(0);
  });

  it("reports the active season's name and event count for a league with data", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "directory-test-league",
        name: "Directory Test League",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
        accessGate: "none",
      },
    });
    const season = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2026 Season",
        slug: "2026-season",
        year: 2026,
        scoringPolicy: PCA_POLICY,
        status: "active",
      },
    });
    await prisma.event.createMany({
      data: [
        { seasonId: season.id, slug: "event-1", name: "Event 1", date: new Date("2026-04-01T00:00:00.000Z") },
        { seasonId: season.id, slug: "event-2", name: "Event 2", date: new Date("2026-05-01T00:00:00.000Z") },
      ],
    });

    const directory = await listLeagueDirectory(prisma);
    const entry = directory.find((l) => l.slug === "directory-test-league");
    expect(entry?.activeSeasonName).toBe("2026 Season");
    expect(entry?.eventCount).toBe(2);
  });

  it("ignores a non-active season when reporting the active-season summary", async () => {
    const league = await prisma.league.create({
      data: {
        slug: "directory-completed-only-league",
        name: "Completed Only League",
        siteTitle: "x",
        siteDescription: "x",
        landingDescription: "x",
      },
    });
    const season = await prisma.season.create({
      data: {
        leagueId: league.id,
        name: "2020 Season",
        slug: "2020-season",
        year: 2020,
        scoringPolicy: PCA_POLICY,
        status: "completed",
      },
    });
    await prisma.event.create({
      data: { seasonId: season.id, slug: "old-event", name: "Old Event", date: new Date("2020-06-01T00:00:00.000Z") },
    });

    const directory = await listLeagueDirectory(prisma);
    const entry = directory.find((l) => l.slug === "directory-completed-only-league");
    expect(entry?.activeSeasonName).toBeNull();
    expect(entry?.eventCount).toBe(0);
  });

  it("is sorted by league name", async () => {
    const directory = await listLeagueDirectory(prisma);
    const names = directory.map((l) => l.name);
    expect(names).toEqual([...names].sort());
  });
});
