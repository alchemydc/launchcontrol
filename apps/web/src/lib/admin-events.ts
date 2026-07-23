import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { buildEventSlug } from "@/lib/ingest";
import { writeAudit } from "@/lib/audit";
import { resolveOrCreateSeason } from "@/lib/season-resolve";

export class EventNotFoundError extends Error {
  constructor(eventId: number) {
    super(`Event ${eventId} not found`);
    this.name = "EventNotFoundError";
  }
}

export class SlugCollisionError extends Error {
  slug: string;
  constructor(slug: string) {
    super(`Another event already has slug '${slug}'`);
    this.name = "SlugCollisionError";
    this.slug = slug;
  }
}

export type Actor = { msrUid: string; name: string };

export type UpdateEventInput = {
  name: string;
  date: string; // YYYY-MM-DD
  location: string | null;
};

export async function updateEventMetadata(
  client: PrismaClient,
  eventId: number,
  input: UpdateEventInput,
  actor: Actor,
) {
  const existing = await client.event.findUnique({
    where: { id: eventId },
    include: { season: { include: { league: true } } },
  });
  if (!existing) throw new EventNotFoundError(eventId);

  const newSlug = buildEventSlug(input.date, input.name);
  if (newSlug !== existing.slug) {
    // Global slug-collision guard: slug is now unique per-season, but the public
    // route addresses events by slug alone, so we still reject any cross-season
    // slug reuse. findFirst because slug is no longer a standalone unique key.
    const collision = await client.event.findFirst({ where: { slug: newSlug } });
    if (collision) throw new SlugCollisionError(newSlug);
  }

  const newDate = new Date(`${input.date}T00:00:00.000Z`);
  // Season.year is an invariant every event must satisfy (season-leaderboard.ts
  // scopes and scores strictly by (league, year)). This admin flow exists
  // precisely to fix misdated events, so a date edit that crosses a calendar
  // year must move the event to the right Season, not just update its date —
  // otherwise the event keeps scoring in its old season's leaderboard.
  const newYear = newDate.getUTCFullYear();
  const crossesYear = newYear !== existing.season.year;

  const before = {
    name: existing.name,
    date: existing.date.toISOString().slice(0, 10),
    location: existing.location,
    slug: existing.slug,
    seasonId: existing.seasonId,
  };

  try {
    const event = await client.$transaction(async (tx) => {
      // Re-resolve (auto-creating if needed, same as ingest) only when the new
      // date's year actually differs — a same-year edit never touches seasonId.
      const seasonId = crossesYear
        ? (await resolveOrCreateSeason(tx, existing.season.league, newYear)).id
        : existing.seasonId;

      const updated = await tx.event.update({
        where: { id: eventId },
        data: {
          name: input.name,
          date: newDate,
          location: input.location,
          slug: newSlug,
          seasonId,
        },
      });

      const after = {
        name: input.name,
        date: input.date,
        location: input.location,
        slug: newSlug,
        seasonId,
      };
      await tx.adminAuditLog.create({
        data: {
          action: "event.update",
          actorMsrUid: actor.msrUid,
          actorName: actor.name,
          targetType: "event",
          targetId: eventId,
          targetSlug: newSlug,
          detail: JSON.stringify({ before, after }),
        },
      });

      return updated;
    });
    return event;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Race backstop: another request created the colliding slug between our
      // findUnique check and the update landing.
      throw new SlugCollisionError(newSlug);
    }
    throw err;
  }
}

export type DeleteEventResult = {
  deleted: { id: number; slug: string; name: string };
  counts: { entries: number; runs: number; videos: number };
  orphanDriversDeleted: number;
};

export async function deleteEventWithSweep(
  client: PrismaClient,
  eventId: number,
  actor: Actor,
): Promise<DeleteEventResult> {
  const event = await client.event.findUnique({ where: { id: eventId } });
  if (!event) throw new EventNotFoundError(eventId);

  return await client.$transaction(async (tx) => {
    // Counted inside the transaction so the audit row reflects exactly what
    // this delete removes, even if rows changed since the caller's last read.
    const entries = await tx.entry.count({ where: { eventId } });
    const runs = await tx.run.count({ where: { entry: { eventId } } });
    const videos = await tx.video.count({ where: { eventId } });
    const counts = { entries, runs, videos };

    await tx.event.delete({ where: { id: eventId } });

    // Global by design: also cleans up any pre-existing orphans, not just
    // drivers orphaned by this delete. The videos guard protects drivers
    // whose only footprint is a video on a different (surviving) event.
    const swept = await tx.driver.deleteMany({
      where: { entries: { none: {} }, videos: { none: {} } },
    });

    await writeAudit(tx, {
      action: "event.delete",
      actorMsrUid: actor.msrUid,
      actorName: actor.name,
      targetType: "event",
      targetId: eventId,
      targetSlug: event.slug,
      detail: { ...counts, orphanDriversDeleted: swept.count },
    });

    return {
      deleted: { id: event.id, slug: event.slug, name: event.name },
      counts,
      orphanDriversDeleted: swept.count,
    };
  });
}
