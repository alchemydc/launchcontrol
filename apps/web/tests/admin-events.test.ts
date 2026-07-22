import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { buildEventSlug, ingestAxdb } from "@/lib/ingest";
import { writeAudit } from "@/lib/audit";
import {
  deleteEventWithSweep,
  updateEventMetadata,
  EventNotFoundError,
  SlugCollisionError,
  type Actor,
  type DeleteEventResult,
} from "@/lib/admin-events";

const TEST_DB_PATH = resolve(__dirname, "..", "test-admin-events.db");
const TEST_DB_URL = "file:./test-admin-events.db";
const FIXTURES_DIR = resolve(__dirname, "fixtures");

const ACTOR: Actor = { msrUid: "test-admin-uid", name: "Test T." };

let prisma: PrismaClient;

let season1Id: number;
let season1Slug: string;
let season2Id: number;
let syntheticSlug: string;

let evanId: number; // unique to season-event-1 (MES-005) — no other entries/videos anywhere
let alexId: number; // shared across season-event-1 and season-event-2 (MES-001) — must survive

beforeAll(async () => {
  rmSync(TEST_DB_PATH, { force: true });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  const r1 = await ingestAxdb(resolve(FIXTURES_DIR, "season-event-1.axdb"), prisma);
  const r2 = await ingestAxdb(resolve(FIXTURES_DIR, "season-event-2.axdb"), prisma);
  const rs = await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma);

  season1Id = r1.event.id;
  season1Slug = r1.event.slug;
  season2Id = r2.event.id;
  syntheticSlug = rs.event.slug;

  const evan = await prisma.driver.findFirstOrThrow({ where: { memberNum: "MES-005" } });
  evanId = evan.id;
  const alex = await prisma.driver.findFirstOrThrow({ where: { memberNum: "MES-001" } });
  alexId = alex.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

// ---------------------------------------------------------------------------
// deleteEventWithSweep — season-event-1 is the "doomed" event. Evan (MES-005)
// entered only this event and holds no video, so he must be swept. Alex
// (MES-001) also entered season-event-2, so he must survive.
// ---------------------------------------------------------------------------
describe("deleteEventWithSweep(season-event-1)", () => {
  let result: DeleteEventResult;

  beforeAll(async () => {
    result = await deleteEventWithSweep(prisma, season1Id, ACTOR);
  });

  it("cascades the deleted event's entries/runs to zero and leaves other events untouched", async () => {
    const entries = await prisma.entry.count({ where: { eventId: season1Id } });
    const runs = await prisma.run.count({ where: { entry: { eventId: season1Id } } });
    expect(entries).toBe(0);
    expect(runs).toBe(0);

    const season2Entries = await prisma.entry.count({ where: { eventId: season2Id } });
    expect(season2Entries).toBeGreaterThan(0);
  });

  it("sweeps the driver who only ever entered the deleted event", async () => {
    const evan = await prisma.driver.findUnique({ where: { id: evanId } });
    expect(evan).toBeNull();
    expect(result.orphanDriversDeleted).toBe(1);
  });

  it("keeps a driver who also entered a surviving event", async () => {
    const alex = await prisma.driver.findUnique({ where: { id: alexId } });
    expect(alex).not.toBeNull();
  });

  it("writes a PII-clean, parseable audit row", async () => {
    const row = await prisma.adminAuditLog.findFirst({
      where: { action: "event.delete", targetId: season1Id },
      orderBy: { id: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorMsrUid).toBe(ACTOR.msrUid);
    expect(row!.actorName).toBe(ACTOR.name);
    expect(row!.targetSlug).toBe(season1Slug);

    const detail = JSON.parse(row!.detail) as Record<string, unknown>;
    expect(detail["orphanDriversDeleted"]).toBe(1);

    // PII sweep: Evan's full synthetic surname ("Elias") must never appear in
    // audit detail or actor fields — only a last-initial redaction is allowed.
    expect(row!.detail).not.toContain("Elias");
    expect(row!.actorName).not.toContain("Elias");
  });
});

// ---------------------------------------------------------------------------
// deleteEventWithSweep — the orphan sweep is global and driver-video-aware.
// One synthetic driver gets a video pointing at a *different*, surviving
// event before the synthetic event is deleted; the video guard must keep
// that driver even though their only Entry row is gone.
// ---------------------------------------------------------------------------
describe("deleteEventWithSweep(synthetic) — video guard", () => {
  let videoDriverId: number;
  let otherDriverIds: number[];
  let result: DeleteEventResult;
  let syntheticEventId: number;

  beforeAll(async () => {
    const syntheticEvent = await prisma.event.findFirstOrThrow({ where: { slug: syntheticSlug } });
    syntheticEventId = syntheticEvent.id;

    const entries = await prisma.entry.findMany({
      where: { eventId: syntheticEventId },
      select: { driverId: true },
    });
    const driverIds = entries.map((e) => e.driverId);

    const videoDriver = await prisma.driver.findFirstOrThrow({ where: { memberNum: "SYN-002" } });
    videoDriverId = videoDriver.id;
    otherDriverIds = driverIds.filter((id) => id !== videoDriverId);

    await prisma.video.create({
      data: { eventId: season2Id, driverId: videoDriverId, url: "https://example.com/clip.mp4" },
    });

    result = await deleteEventWithSweep(prisma, syntheticEventId, ACTOR);
  });

  it("keeps a driver whose only remaining footprint is a video on a different event", async () => {
    const driver = await prisma.driver.findUnique({ where: { id: videoDriverId } });
    expect(driver).not.toBeNull();
  });

  it("sweeps the other now-orphaned drivers", async () => {
    const remaining = await prisma.driver.findMany({ where: { id: { in: otherDriverIds } } });
    expect(remaining).toHaveLength(0);
    expect(result.orphanDriversDeleted).toBe(otherDriverIds.length);
  });
});

// ---------------------------------------------------------------------------
// updateEventMetadata — exercised against season-event-2, the only event
// still standing after the two describe blocks above.
// ---------------------------------------------------------------------------
describe("updateEventMetadata(season-event-2)", () => {
  it("regenerates the slug via buildEventSlug() when name/date change", async () => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: season2Id } });
    const newName = "Season Event 2 — Renamed";
    const newDate = "2026-04-06";

    const updated = await updateEventMetadata(
      prisma,
      season2Id,
      { name: newName, date: newDate, location: before.location },
      ACTOR,
    );

    expect(updated.slug).toBe(buildEventSlug(newDate, newName));
    expect(updated.slug).not.toBe(before.slug);
  });

  it("leaves the slug unchanged on a location-only edit", async () => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: season2Id } });

    const updated = await updateEventMetadata(
      prisma,
      season2Id,
      { name: before.name, date: before.date.toISOString().slice(0, 10), location: "New Location" },
      ACTOR,
    );

    expect(updated.slug).toBe(before.slug);
    expect(updated.location).toBe("New Location");
  });

  it("throws SlugCollisionError and leaves the target + audit trail unchanged on collision", async () => {
    const collisionSlug = "2099-01-01-collision-target";
    // Event.seasonId is required now; attach this throwaway collision fixture to
    // the same season as the target event (any existing season works here).
    const target = await prisma.event.findUniqueOrThrow({ where: { id: season2Id } });
    const dummy = await prisma.event.create({
      data: {
        seasonId: target.seasonId,
        slug: collisionSlug,
        name: "Collision Target",
        date: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    const before = await prisma.event.findUniqueOrThrow({ where: { id: season2Id } });
    const auditCountBefore = await prisma.adminAuditLog.count();

    await expect(
      updateEventMetadata(
        prisma,
        season2Id,
        { name: "Collision Target", date: "2099-01-01", location: before.location },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(SlugCollisionError);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: season2Id } });
    expect(after.slug).toBe(before.slug);
    expect(after.name).toBe(before.name);

    const auditCountAfter = await prisma.adminAuditLog.count();
    expect(auditCountAfter).toBe(auditCountBefore);

    await prisma.event.delete({ where: { id: dummy.id } });
  });

  it("throws EventNotFoundError for a bogus event id", async () => {
    await expect(
      updateEventMetadata(prisma, 999_999, { name: "Nope", date: "2026-01-01", location: null }, ACTOR),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe("deleteEventWithSweep — bogus id", () => {
  it("throws EventNotFoundError for a bogus event id", async () => {
    await expect(deleteEventWithSweep(prisma, 999_999, ACTOR)).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: the original bug was a corrected re-upload minting a *second*
// Event row instead of replacing the bad one. Deleting the bad event and
// re-ingesting the same source file must land on exactly one Event row for
// that slug — never a duplicate.
// ---------------------------------------------------------------------------
describe("regression: delete + re-ingest does not duplicate", () => {
  it("re-ingesting after delete produces exactly one event row for the slug", async () => {
    const beforeCount = await prisma.event.count({ where: { slug: syntheticSlug } });
    expect(beforeCount).toBe(0); // deleted by the video-guard describe block above

    const reingested = await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma);
    expect(reingested.status).toBe("ingested");
    expect(reingested.event.slug).toBe(syntheticSlug);
    expect(await prisma.event.count({ where: { slug: syntheticSlug } })).toBe(1);

    // Ingesting the identical file again must update in place, not duplicate.
    const reingestedAgain = await ingestAxdb(resolve(FIXTURES_DIR, "synthetic.axdb"), prisma);
    expect(reingestedAgain.status).toBe("unchanged");
    expect(await prisma.event.count({ where: { slug: syntheticSlug } })).toBe(1);
  });
});

describe("writeAudit", () => {
  it("stores stringified detail JSON and actor fields", async () => {
    const before = await prisma.adminAuditLog.count();

    await writeAudit(prisma, {
      action: "event.update",
      actorMsrUid: "unit-test-uid",
      actorName: "Unit T.",
      targetType: "event",
      targetId: season2Id,
      targetSlug: "some-slug",
      detail: { hello: "world", n: 42 },
    });

    expect(await prisma.adminAuditLog.count()).toBe(before + 1);

    const row = await prisma.adminAuditLog.findFirst({
      where: { actorMsrUid: "unit-test-uid" },
      orderBy: { id: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorName).toBe("Unit T.");
    expect(row!.targetType).toBe("event");
    expect(row!.targetId).toBe(season2Id);
    expect(row!.targetSlug).toBe("some-slug");
    expect(JSON.parse(row!.detail)).toEqual({ hello: "world", n: 42 });
  });
});
