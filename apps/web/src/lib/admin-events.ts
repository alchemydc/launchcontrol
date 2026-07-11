import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { buildEventSlug } from "@/lib/ingest";
import { writeAudit } from "@/lib/audit";

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
  const existing = await client.event.findUnique({ where: { id: eventId } });
  if (!existing) throw new EventNotFoundError(eventId);

  const newSlug = buildEventSlug(input.date, input.name);
  if (newSlug !== existing.slug) {
    const collision = await client.event.findUnique({ where: { slug: newSlug } });
    if (collision) throw new SlugCollisionError(newSlug);
  }

  const before = {
    name: existing.name,
    date: existing.date.toISOString().slice(0, 10),
    location: existing.location,
    slug: existing.slug,
  };
  const after = {
    name: input.name,
    date: input.date,
    location: input.location,
    slug: newSlug,
  };

  try {
    const [event] = await client.$transaction([
      client.event.update({
        where: { id: eventId },
        data: {
          name: input.name,
          date: new Date(`${input.date}T00:00:00.000Z`),
          location: input.location,
          slug: newSlug,
        },
      }),
      client.adminAuditLog.create({
        data: {
          action: "event.update",
          actorMsrUid: actor.msrUid,
          actorName: actor.name,
          targetType: "event",
          targetId: eventId,
          targetSlug: newSlug,
          detail: JSON.stringify({ before, after }),
        },
      }),
    ]);
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
