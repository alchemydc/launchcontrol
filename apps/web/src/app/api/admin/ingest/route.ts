import { unlinkSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { validateAxdbBuffer } from "@/lib/axdb-validate";
import { ingestAxdb } from "@/lib/ingest";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session.msrUid) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const msrUid = session.msrUid;

  if (!isAdmin(msrUid)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart request" }, { status: 400 });
  }

  const fileField = formData.get("file");
  if (!fileField || !(fileField instanceof File)) {
    return NextResponse.json({ error: "file field missing" }, { status: 400 });
  }

  const file = fileField;

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  if (!file.name.endsWith(".axdb")) {
    return NextResponse.json({ error: "file must have .axdb extension" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const validated = validateAxdbBuffer(buf);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { tempPath } = validated;
  try {
    const summary = await ingestAxdb(tempPath, prisma);
    const { status, event, counts } = summary;
    console.log({ event: "admin-ingest", admin: msrUid, status, slug: event.slug, counts });
    return NextResponse.json({ status, event, counts }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 422 },
    );
  } finally {
    try { unlinkSync(tempPath); } catch { /* best-effort */ }
  }
}
