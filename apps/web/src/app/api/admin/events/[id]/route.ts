import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  updateEventMetadata,
  deleteEventWithSweep,
  EventNotFoundError,
  SlugCollisionError,
  type Actor,
} from "@/lib/admin-events";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function guard(): Promise<
  | { ok: true; actor: Actor }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();

  if (!session.msrUid) {
    return { ok: false, response: NextResponse.json({ error: "not authenticated" }, { status: 401 }) };
  }

  const msrUid = session.msrUid;

  if (!(await isAdmin(msrUid))) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const actorName = [session.firstName, session.lastInitial].filter(Boolean).join(" ") || "unknown";
  return { ok: true, actor: { msrUid, name: actorName } };
}

function parseEventId(idParam: string): number | null {
  if (!/^\d+$/.test(idParam)) return null;
  return Number(idParam);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guarded = await guard();
  if (!guarded.ok) return guarded.response;

  const { id } = await ctx.params;
  const eventId = parseEventId(id);
  if (eventId == null) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const { name, date, location } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
  }
  if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "date must be a valid YYYY-MM-DD string" }, { status: 400 });
  }
  if (location !== null && location !== undefined && typeof location !== "string") {
    return NextResponse.json({ error: "location must be a string or null" }, { status: 400 });
  }

  try {
    const event = await updateEventMetadata(
      prisma,
      eventId,
      { name: name.trim(), date, location: location?.trim() ? location.trim() : null },
      guarded.actor,
    );
    return NextResponse.json({ event }, { status: 200 });
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }
    if (err instanceof SlugCollisionError) {
      return NextResponse.json(
        { error: `another event already has slug '${err.slug}'` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 422 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guarded = await guard();
  if (!guarded.ok) return guarded.response;

  const { id } = await ctx.params;
  const eventId = parseEventId(id);
  if (eventId == null) {
    return NextResponse.json({ error: "invalid event id" }, { status: 400 });
  }

  try {
    const result = await deleteEventWithSweep(prisma, eventId, guarded.actor);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 422 },
    );
  }
}
