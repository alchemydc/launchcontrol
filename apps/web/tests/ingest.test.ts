import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";

const TEST_DB_PATH = resolve(__dirname, "..", "test.db");
const TEST_DB_URL = "file:./test.db";
const FIXTURE = resolve(__dirname, "fixtures", "synthetic.axdb");

let prisma: PrismaClient;

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
});

describe("ingestAxdb(synthetic.axdb)", () => {
  it("ingests with the PRD DoD counts", async () => {
    const result = await ingestAxdb(FIXTURE, prisma);

    expect(result.status).toBe("ingested");
    expect(result.event.slug).toBe("2026-01-01-synthetic-fixture-event");
    expect(result.counts).toEqual({ classes: 3, drivers: 5, entries: 5, runs: 14 });

    const [dnf, rrn, clean] = await Promise.all([
      prisma.run.count({ where: { disposition: RunDisposition.DNF } }),
      prisma.run.count({ where: { disposition: RunDisposition.RRN } }),
      prisma.run.count({ where: { disposition: RunDisposition.CLEAN } }),
    ]);
    expect(dnf).toBe(1);
    expect(rrn).toBe(1);
    expect(clean).toBe(12);

    const classes = await prisma.carClass.findMany({ orderBy: { code: "asc" } });
    expect(classes.map((c) => c.code)).toEqual(["C1", "CS", "TO"]);
    expect(Number(classes[0]!.paxIndex)).toBe(1);
    expect(Number(classes[1]!.paxIndex)).toBeCloseTo(0.92, 4);
    expect(Number(classes[2]!.paxIndex)).toBeCloseTo(0.85, 4);
  });

  it("is idempotent: a second run reports 'unchanged'", async () => {
    const result = await ingestAxdb(FIXTURE, prisma);
    expect(result.status).toBe("unchanged");
    expect(result.counts).toEqual({ classes: 3, drivers: 5, entries: 5, runs: 14 });
  });

  it("preserves the DNF run (no rawTimeMs)", async () => {
    const dnfRuns = await prisma.run.findMany({
      where: { disposition: RunDisposition.DNF },
    });
    expect(dnfRuns).toHaveLength(1);
    expect(dnfRuns[0]!.rawTimeMs).toBeNull();
  });

  it("preserves the cone penalty on the seeded run", async () => {
    const coned = await prisma.run.findMany({ where: { cones: { gt: 0 } } });
    expect(coned).toHaveLength(1);
    expect(coned[0]!.cones).toBe(1);
  });

  it("redacts driver last names to a single initial + period", async () => {
    const drivers = await prisma.driver.findMany();
    expect(drivers).toHaveLength(5);

    for (const d of drivers) {
      expect(d.lastInitial).toMatch(/^[A-Z?]\.$/);
      expect(d.lastInitial).toHaveLength(2);
    }

    const initials = drivers.map((d) => d.lastInitial).sort();
    expect(initials).toEqual(["A.", "B.", "C.", "D.", "E."]);
  });

  it("never persists a full source last name anywhere in the Driver table", async () => {
    const drivers = await prisma.driver.findMany();
    const fixtureLastNames = ["Ada", "Brook", "Chen", "Diaz", "Eckhart"];
    for (const d of drivers) {
      const blob = JSON.stringify(d);
      for (const name of fixtureLastNames) {
        expect(
          blob.includes(name),
          `Driver row leaks full last name '${name}': ${blob}`,
        ).toBe(false);
      }
    }
  });
});
