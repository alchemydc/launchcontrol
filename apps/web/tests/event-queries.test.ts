import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import {
  countSiblingEventsByDate,
  findEventBySlug,
  findEventsByDate,
} from "@/lib/event-queries";
import { ensureLeagueAndSeasons, ensureRuleset } from "./helpers/league-fixture";

// Task 4: event-page data access, league-scoped. `Event.slug` is only unique
// per-season (`@@unique([seasonId, slug])`), so these fns take an explicit
// `leagueId` and scope the lookup through `season.leagueId` — this suite
// pins that two leagues sharing a slug or a calendar date can never
// cross-resolve into each other's event pages.

const TEST_DB_PATH = resolve(__dirname, "..", "test-event-queries.db");
const TEST_DB_URL = "file:./test-event-queries.db";

let prisma: PrismaClient;
let leagueAId: number;
let leagueBId: number;
let seasonAId: number;
let seasonBId: number;

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  const leagueA = await ensureLeagueAndSeasons(prisma, [2026], "pca-rmr");
  const leagueB = await ensureLeagueAndSeasons(prisma, [2026], "league-b");
  leagueAId = leagueA.leagueId;
  leagueBId = leagueB.leagueId;

  seasonAId = leagueA.seasonIdByYear.get(2026)!;
  seasonBId = leagueB.seasonIdByYear.get(2026)!;

  // Same slug, same date, in two different leagues' seasons.
  await prisma.event.create({
    data: {
      seasonId: seasonAId,
      slug: "2026-01-10-clash",
      name: "League A Event",
      date: new Date("2026-01-10T00:00:00.000Z"),
    },
  });
  await prisma.event.create({
    data: {
      seasonId: seasonBId,
      slug: "2026-01-10-clash",
      name: "League B Event",
      date: new Date("2026-01-10T00:00:00.000Z"),
    },
  });

  // A second same-date session, but only in league A — makes league A's
  // event 1 a genuine "combined event" sibling without touching league B.
  await prisma.event.create({
    data: {
      seasonId: seasonAId,
      slug: "2026-01-10-clash-pm",
      name: "League A Event (PM)",
      date: new Date("2026-01-10T00:00:00.000Z"),
    },
  });

  // A SECOND league-A season in the same year (the supported Winter-series
  // shape) with an event on the very same date — a different competition
  // that must never count as a combined-event sibling of season A's events
  // (PR #99 review: combined grouping is season-scoped).
  const winterSeason = await prisma.season.create({
    data: {
      leagueId: leagueAId,
      name: "2026 Winter",
      slug: "2026-winter",
      year: 2026,
      plannedEvents: 0,
      rulesetId: await ensureRuleset(prisma, leagueAId),
    },
  });
  await prisma.event.create({
    data: {
      seasonId: winterSeason.id,
      slug: "2026-01-10-winter",
      name: "League A Winter Event",
      date: new Date("2026-01-10T00:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("findEventBySlug", () => {
  it("resolves the event belonging to the given league when two leagues share a slug", async () => {
    const eventA = await findEventBySlug(leagueAId, "2026-01-10-clash", prisma);
    const eventB = await findEventBySlug(leagueBId, "2026-01-10-clash", prisma);
    expect(eventA?.name).toBe("League A Event");
    expect(eventB?.name).toBe("League B Event");
    expect(eventA?.id).not.toBe(eventB?.id);
  });

  it("returns null for a slug that doesn't exist in the given league", async () => {
    const result = await findEventBySlug(leagueAId, "no-such-slug", prisma);
    expect(result).toBeNull();
  });
});

describe("countSiblingEventsByDate", () => {
  it("counts only same-SEASON siblings sharing the date", async () => {
    const eventA = await findEventBySlug(leagueAId, "2026-01-10-clash", prisma);
    const count = await countSiblingEventsByDate(seasonAId, eventA!.date, eventA!.id, prisma);
    // Season A has a second same-date session; league B's same-date event
    // AND league A's own same-date Winter-season event must not be counted.
    expect(count).toBe(1);
  });

  it("returns 0 for league B's season, which has no second session on that date", async () => {
    const eventB = await findEventBySlug(leagueBId, "2026-01-10-clash", prisma);
    const count = await countSiblingEventsByDate(seasonBId, eventB!.date, eventB!.id, prisma);
    expect(count).toBe(0);
  });
});

describe("findEventsByDate", () => {
  it("returns only the given league's events on that date", async () => {
    const date = new Date("2026-01-10T00:00:00.000Z");
    const eventsA = await findEventsByDate(leagueAId, date, prisma);
    const eventsB = await findEventsByDate(leagueBId, date, prisma);
    // League-scoped (all seasons): the combined-event VIEW partitions by
    // season before merging — see combined-event-view.tsx.
    expect(eventsA.map((e) => e.name).sort()).toEqual([
      "League A Event",
      "League A Event (PM)",
      "League A Winter Event",
    ]);
    expect(eventsB.map((e) => e.name)).toEqual(["League B Event"]);
  });
});
