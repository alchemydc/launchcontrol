import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";

// The league-foundation migration seeds the PCA league + PCA Classic scoring system,
// backfills a Season per distinct Event year, and league-scopes CarClass. On a fresh
// (eventless) DB the seed creates the league/preset but no seasons; ingest then
// auto-creates a bare Season per event year. This suite pins both behaviors.

const TEST_DB_PATH = resolve(__dirname, "..", "test-league-seed.db");
const TEST_DB_URL = "file:./test-league-seed.db";
const FIXTURES_DIR = resolve(__dirname, "fixtures");

// Exact production branding strings (club-config defaults) copied into the seed.
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

describe("fresh migrate deploy seeds", () => {
  it("creates exactly one PCA league with the production branding strings", async () => {
    const leagues = await prisma.league.findMany();
    expect(leagues).toHaveLength(1);
    const league = leagues[0]!;
    expect(league.slug).toBe("pca-rmr");
    expect(league.name).toBe("PCA Rocky Mountain Region");
    expect(league.siteTitle).toBe("Launch Control · PCA RMR");
    expect(league.siteDescription).toBe(
      "Rocky Mountain Region autocross results, calendar, and community media.",
    );
    expect(league.footerText).toBe(
      "Built for PCA Rocky Mountain Region · Autocross results from VisualAX",
    );
    expect(league.landingDescription).toBe(
      "Sign in with your MotorsportReg account to access Rocky Mountain Region autocross results, sortable event leaderboards, season standings, and driver profiles.",
    );
    expect(league.accessGate).toBe("required");
    expect(league.msrOrgId).toBeNull();
    expect(league.smugmugUser).toBe("rmrpca");
    expect(league.smugmugDisciplinePath).toBe("Autocross");
  });

  it("creates the PCA Classic scoring system with the v1 policy", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const systems = await prisma.scoringSystem.findMany({ where: { leagueId: league.id } });
    expect(systems).toHaveLength(1);
    expect(systems[0]!.name).toBe("PCA Classic");
    expect(systems[0]!.policy).toBe(PCA_POLICY);
  });

  it("seeds no seasons on an eventless DB", async () => {
    expect(await prisma.season.count()).toBe(0);
  });
});

describe("Season resolution + backfill via ingest", () => {
  beforeAll(async () => {
    // Two 2026 events + one 2027 event → two distinct season years.
    await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma); // 2026
    await ingestAxdb(resolve(FIXTURES_DIR, "season-event-1.axdb"), prisma); // 2026
    await ingestAxdb(resolve(FIXTURES_DIR, "combined-event-1-opener.axdb"), prisma); // 2027
  });

  it("auto-creates one Season per distinct event year, snapshotting the PCA policy", async () => {
    const seasons = await prisma.season.findMany({ orderBy: { year: "asc" } });
    expect(seasons.map((s) => s.year)).toEqual([2026, 2027]);
    for (const s of seasons) {
      expect(s.name).toBe(`${s.year} Season`);
      expect(s.scoringPolicy).toBe(PCA_POLICY);
      expect(s.paxTable).toBe("{}");
      expect(s.status).toBe("active");
    }
  });

  it("gives every Event a seasonId whose season year matches the event's own year", async () => {
    const events = await prisma.event.findMany({ include: { season: true } });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.seasonId).not.toBeNull();
      expect(e.season.year).toBe(e.date.getUTCFullYear());
    }
  });

  it("scopes every CarClass to the PCA league", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const classes = await prisma.carClass.findMany();
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) expect(c.leagueId).toBe(league.id);
  });
});

describe("composite-unique enforcement", () => {
  it("rejects a duplicate (seasonId, slug) Event", async () => {
    const ev = await prisma.event.findFirstOrThrow();
    await expect(
      prisma.event.create({
        data: { seasonId: ev.seasonId, slug: ev.slug, name: "dup", date: new Date("2026-01-01T00:00:00.000Z") },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (leagueId, name) Season", async () => {
    const season = await prisma.season.findFirstOrThrow();
    await expect(
      prisma.season.create({
        data: { leagueId: season.leagueId, name: season.name, year: season.year, scoringPolicy: PCA_POLICY },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (leagueId, name) ScoringSystem", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    await expect(
      prisma.scoringSystem.create({ data: { leagueId: league.id, name: "PCA Classic", policy: PCA_POLICY } }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (leagueId, msrUid) LeagueMembership", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, msrUid: "uid-123", role: "ADMIN" },
    });
    await expect(
      prisma.leagueMembership.create({ data: { leagueId: league.id, msrUid: "uid-123", role: "MEMBER" } }),
    ).rejects.toThrow();
  });

  it("enforces @@unique([leagueId, code]) on CarClass but isolates the same code across leagues", async () => {
    const league = await prisma.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } });
    const anyClass = await prisma.carClass.findFirstOrThrow({ where: { leagueId: league.id } });

    // Duplicate (leagueId, code) is rejected.
    await expect(
      prisma.carClass.create({ data: { leagueId: league.id, code: anyClass.code, paxIndex: 1 } }),
    ).rejects.toThrow();

    // The same class code under a different league is allowed — the pax-factor
    // clobbering trap the league scoping exists to prevent.
    const other = await prisma.league.create({
      data: {
        slug: "isolation-league",
        name: "Isolation Test",
        siteTitle: "x",
        siteDescription: "x",
        footerText: "x",
        landingDescription: "x",
      },
    });
    const created = await prisma.carClass.create({
      data: { leagueId: other.id, code: anyClass.code, paxIndex: 0.5 },
    });
    expect(created.id).toBeGreaterThan(0);
    expect(Number(created.paxIndex)).toBe(0.5);
  });
});
