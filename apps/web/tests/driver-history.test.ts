import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { ingestAxdb } from "@/lib/ingest";
import {
  bestPaxMsForEntry,
  buildDriverHistory,
  type EntryForHistory,
} from "@/lib/driver-history";

const TEST_DB_PATH = resolve(__dirname, "..", "test-driver-history.db");
const TEST_DB_URL = "file:./test-driver-history.db";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const SEASON_EVENTS = [
  "season-event-1.axdb",
  "season-event-2.axdb",
  "season-event-3.axdb",
  "season-event-4.axdb",
  "season-event-5.axdb",
];

let prisma: PrismaClient;
let alexId: number;
let beaId: number;
let camId: number;
let deeId: number;
let evanId: number;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  for (const filename of SEASON_EVENTS) {
    await ingestAxdb(resolve(FIXTURES_DIR, filename), prisma);
  }

  const drivers = await prisma.driver.findMany({
    where: { memberNum: { in: ["MES-001", "MES-002", "MES-003", "MES-004", "MES-005"] } },
  });
  const byMember = new Map(drivers.map((d) => [d.memberNum!, d.id]));
  alexId = byMember.get("MES-001")!;
  beaId = byMember.get("MES-002")!;
  camId = byMember.get("MES-003")!;
  deeId = byMember.get("MES-004")!;
  evanId = byMember.get("MES-005")!;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

// ---------------------------------------------------------------------------
// Helper to build EntryForHistory-shaped objects for the pure-function tests.
// ---------------------------------------------------------------------------
function entry(
  paxIndex: number,
  runs: Array<{
    rawTimeMs: number | null;
    cones?: number;
    disposition?: "CLEAN" | "DNF" | "RRN" | "OFF" | "DSQ";
  }>,
  bestCommittedRunNumber: number | null = null,
): EntryForHistory {
  return {
    id: 1,
    driverId: 1,
    carNumber: "1",
    bestCommittedRunNumber,
    class: { code: "C1" },
    paxClass: { code: "C1", paxIndex: { toString: () => String(paxIndex) } },
    runs: runs.map((r, i) => ({
      runNumber: i + 1,
      rawTimeMs: r.rawTimeMs,
      cones: r.cones ?? 0,
      disposition: r.disposition ?? "CLEAN",
    })),
  };
}

describe("bestPaxMsForEntry", () => {
  it("returns nulls when no CLEAN runs exist", () => {
    const result = bestPaxMsForEntry(
      entry(1.0, [
        { rawTimeMs: 50000, disposition: "DNF" },
        { rawTimeMs: 51000, disposition: "RRN" },
      ]),
    );
    expect(result).toEqual({ bestRawMs: null, bestPaxMs: null });
  });

  it("filters out non-CLEAN runs and picks min of remaining", () => {
    const result = bestPaxMsForEntry(
      entry(1.0, [
        { rawTimeMs: 52000, disposition: "CLEAN" },
        { rawTimeMs: 49000, disposition: "DNF" }, // fastest but DNF → excluded
        { rawTimeMs: 50500, disposition: "RRN" }, // also excluded
        { rawTimeMs: 51000, disposition: "CLEAN" },
      ]),
    );
    expect(result.bestRawMs).toBe(51000);
    expect(result.bestPaxMs).toBe(51000);
  });

  it("applies cone penalty before taking min", () => {
    // 50000 + 1*2000 cone = 52000; vs 51500 clean → 51500 wins
    const result = bestPaxMsForEntry(
      entry(1.0, [
        { rawTimeMs: 50000, cones: 1 },
        { rawTimeMs: 51500, cones: 0 },
      ]),
    );
    expect(result.bestRawMs).toBe(51500);
  });

  it("uses cone-corrected time when cones make a run still the fastest", () => {
    // 50000 + 1*2000 = 52000; vs 53000 clean → 52000 wins
    const result = bestPaxMsForEntry(
      entry(1.0, [
        { rawTimeMs: 50000, cones: 1 },
        { rawTimeMs: 53000, cones: 0 },
      ]),
    );
    expect(result.bestRawMs).toBe(52000);
  });

  it("applies pax multiplier and rounds", () => {
    const result = bestPaxMsForEntry(
      entry(0.92, [{ rawTimeMs: 50000 }]),
    );
    expect(result.bestRawMs).toBe(50000);
    expect(result.bestPaxMs).toBe(46000); // round(50000 * 0.92)
  });

  it("returns nulls when CLEAN runs exist but rawTimeMs is null", () => {
    const result = bestPaxMsForEntry(
      entry(1.0, [{ rawTimeMs: null, disposition: "CLEAN" }]),
    );
    expect(result).toEqual({ bestRawMs: null, bestPaxMs: null });
  });

  it("honors bestCommittedRunNumber over the fastest CLEAN run", () => {
    // R1=58436ms (committed), R2=57534ms (faster clean) — mirrors Ellen G. at 2025-08-16.
    // bestCommittedRunNumber=1 → should use R1 (58436ms), not R2 (57534ms).
    const result = bestPaxMsForEntry(
      entry(
        1.0,
        [
          { rawTimeMs: 58436, cones: 0 }, // R1: committed best (slower)
          { rawTimeMs: 57534, cones: 0 }, // R2: faster clean (should be ignored)
        ],
        1, // bestCommittedRunNumber = 1 (R1)
      ),
    );
    expect(result.bestRawMs).toBe(58436);
    expect(result.bestPaxMs).toBe(58436);
  });

  it("falls back to fastest CLEAN when bestCommittedRunNumber is null", () => {
    const result = bestPaxMsForEntry(
      entry(
        1.0,
        [
          { rawTimeMs: 58436, cones: 0 },
          { rawTimeMs: 57534, cones: 0 },
        ],
        null, // no committed pointer → fallback
      ),
    );
    expect(result.bestRawMs).toBe(57534);
  });

  it("falls back to fastest CLEAN when committed run has null rawTimeMs", () => {
    // bestCommittedRunNumber points to a DNF (null rawTimeMs) → fall through to CLEAN
    const result = bestPaxMsForEntry(
      entry(
        1.0,
        [
          { rawTimeMs: null, disposition: "DNF" }, // R1: committed but DNF
          { rawTimeMs: 57534, cones: 0 },           // R2: fastest CLEAN
        ],
        1, // committed = R1 (DNF, null rawTimeMs)
      ),
    );
    expect(result.bestRawMs).toBe(57534);
  });
});

// ---------------------------------------------------------------------------
// Fixture overview (see build-multi-event-season.mjs header for full math):
//
//  Event 1 (2026-03-01) — 5 entrants
//    Pooled PAX:  Alex 50000, Cam(CS) 52440, Bea 55000, Dee 60000, Evan 62000
//  Event 2 (2026-04-05) — 4 entrants
//    Pooled PAX:  Alex 51000, Bea 53000, Cam(CS) 53360, Dee 56000
//  Event 3 (2026-05-10) — 4 entrants
//    Pooled PAX:  Alex 52000, Bea 54000, Cam(CS) 54280, Dee(CS) 56120
//  Event 4 (2026-06-14) — 3 entrants
//    Pooled PAX:  Alex 53000, Bea 57000, Dee(CS) 57040
//  Event 5 (2026-07-19) — 3 entrants, Cam DNF
//    Pooled PAX:  Bea(CS) 55200, Alex (54000+1cone)*1.0 = 56000.  Cam excluded.
// ---------------------------------------------------------------------------

describe("buildDriverHistory", () => {
  it("returns events in strict chronological order", async () => {
    const history = await buildDriverHistory(alexId, prisma);
    expect(history).toHaveLength(5);
    for (let i = 1; i < history.length; i++) {
      expect(history[i]!.eventDate.getTime()).toBeGreaterThan(
        history[i - 1]!.eventDate.getTime(),
      );
    }
  });

  it("omits events where the driver had no entry (Cam absent from event 4)", async () => {
    const history = await buildDriverHistory(camId, prisma);
    const eventNames = history.map((h) => h.eventName);
    expect(eventNames).toEqual([
      "Season Event 1",
      "Season Event 2",
      "Season Event 3",
      "Season Event 5",
    ]);
    expect(eventNames).not.toContain("Season Event 4");
  });

  it("computes Alex's per-event best, position, and leader delta", async () => {
    const history = await buildDriverHistory(alexId, prisma);

    // Event 1: Alex is pooled leader → pos=1, delta=0
    expect(history[0]!.bestRawMs).toBe(50000);
    expect(history[0]!.bestPaxMs).toBe(50000);
    expect(history[0]!.leaderPaxMs).toBe(50000);
    expect(history[0]!.position).toBe(1);
    expect(history[0]!.entrantCount).toBe(5);
    expect(history[0]!.diffFromLeaderPct).toBe(0);

    // Events 2-4: Alex remains pooled PAX leader
    for (const idx of [1, 2, 3]) {
      expect(history[idx]!.position).toBe(1);
      expect(history[idx]!.diffFromLeaderPct).toBe(0);
    }

    // Event 5: Bea (CS) is PAX-faster, so Alex is pos=2.
    // Alex raw = 54000 + 1*2000 = 56000; Bea PAX = round(60000 * 0.92) = 55200.
    expect(history[4]!.bestRawMs).toBe(56000);
    expect(history[4]!.bestPaxMs).toBe(56000);
    expect(history[4]!.leaderPaxMs).toBe(55200);
    expect(history[4]!.position).toBe(2);
    expect(history[4]!.entrantCount).toBe(2);
    expect(history[4]!.diffFromLeaderPct).toBeCloseTo((56000 - 55200) / 55200, 6);
  });

  it("computes Bea's leader-delta at event 1", async () => {
    const history = await buildDriverHistory(beaId, prisma);
    const e1 = history.find((h) => h.eventName === "Season Event 1")!;
    expect(e1.bestPaxMs).toBe(55000);
    expect(e1.leaderPaxMs).toBe(50000);
    expect(e1.diffFromLeaderPct).toBeCloseTo(0.1, 6); // (55000-50000)/50000
    expect(e1.position).toBe(3);
    expect(e1.entrantCount).toBe(5);
  });

  it("renders Cam's DNF-only event 5 with nulls but still includes the row", async () => {
    const history = await buildDriverHistory(camId, prisma);
    const e5 = history.find((h) => h.eventName === "Season Event 5")!;
    expect(e5).toBeDefined();
    expect(e5.bestRawMs).toBeNull();
    expect(e5.bestPaxMs).toBeNull();
    expect(e5.position).toBeNull();
    expect(e5.percentile).toBeNull();
    expect(e5.diffFromLeaderPct).toBeNull();
    expect(e5.diffFromMedianPct).toBeNull();
    // Leader/median computed from the other entrants; entrantCount excludes Cam.
    expect(e5.leaderPaxMs).toBe(55200);
    expect(e5.entrantCount).toBe(2);
    // Display fields still populated from Cam's CS entry.
    expect(e5.classCode).toBe("CS");
    expect(e5.paxClassCode).toBe("CS");
    expect(e5.carNumber).toBe("103");
  });

  it("computes entrantCount and percentile correctly", async () => {
    const history = await buildDriverHistory(evanId, prisma);
    // Evan only attended event 1 (5 entrants), placed 5th.
    expect(history).toHaveLength(1);
    expect(history[0]!.entrantCount).toBe(5);
    expect(history[0]!.position).toBe(5);
    expect(history[0]!.percentile).toBe(1); // 5/5
  });

  it("computes median PAX correctly at event 1 (odd count)", async () => {
    // Sorted PAX at event 1: [50000, 52440, 55000, 60000, 62000] → median = 55000 (Bea).
    const history = await buildDriverHistory(beaId, prisma);
    const e1 = history.find((h) => h.eventName === "Season Event 1")!;
    expect(e1.medianPaxMs).toBe(55000);
    expect(e1.diffFromMedianPct).toBe(0); // Bea IS the median
  });

  it("computes median PAX correctly at event 5 (even count)", async () => {
    // Sorted PAX at event 5: [55200, 56000] → median = round((55200+56000)/2) = 55600.
    const history = await buildDriverHistory(alexId, prisma);
    const e5 = history.find((h) => h.eventName === "Season Event 5")!;
    expect(e5.medianPaxMs).toBe(55600);
    expect(e5.diffFromMedianPct).toBeCloseTo((56000 - 55600) / 55600, 6);
  });

  it("returns [] for a driver with no entries", async () => {
    const history = await buildDriverHistory(999_999, prisma);
    expect(history).toEqual([]);
  });
});
