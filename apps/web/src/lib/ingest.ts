import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";

export type IngestSummary = {
  status: "ingested" | "unchanged";
  event: { id: number; slug: string; name: string };
  counts: { classes: number; drivers: number; entries: number; runs: number };
};

type SrcEvent = { id: number; event_name: string; event_date: string };
type SrcClass = { id: number; class_name: string; pax: number };
type SrcDriver = {
  id: number;
  first_name: string;
  last_name: string;
  number: string;
  class_id: number;
  paxmult_id: number;
  car_model: string | null;
  member_num: string | null;
};
type SrcRun = {
  id: number;
  driver_id: number;
  start_tick: number | null;
  finish_tick: number | null;
  cones: number | null;
  disposition: string | null;
};

const REQUIRED_TABLES = ["events", "classes", "drivers", "registrations", "runs"] as const;

function redactLastName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?.";
  return trimmed[0]!.toUpperCase() + ".";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toDisposition(raw: string | null): RunDisposition {
  if (raw === "DNF") return RunDisposition.DNF;
  if (raw === "RRN") return RunDisposition.RRN;
  return RunDisposition.CLEAN;
}

export async function ingestAxdb(
  path: string,
  client: PrismaClient = defaultClient,
): Promise<IngestSummary> {
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");

  const src = new Database(path, { readonly: true });
  try {
    const presentTables = new Set(
      src
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    for (const t of REQUIRED_TABLES) {
      if (!presentTables.has(t)) {
        throw new Error(`Source DB is missing required table '${t}' — not an AxWare .axdb`);
      }
    }

    const srcEvent = src
      .prepare("SELECT id, event_name, event_date FROM events ORDER BY id LIMIT 1")
      .get() as SrcEvent | undefined;
    if (!srcEvent) throw new Error("Source .axdb contains no event row");

    const srcClasses = src
      .prepare("SELECT id, class_name, pax FROM classes ORDER BY id")
      .all() as SrcClass[];

    const srcDrivers = src
      .prepare(
        `SELECT d.id, d.first_name, d.last_name, d.number, d.class_id, d.paxmult_id,
                d.car_model, d.member_num
         FROM drivers d
         JOIN registrations r ON r.driver_id = d.id AND r.event_id = ?
         ORDER BY d.id`,
      )
      .all(srcEvent.id) as SrcDriver[];

    const srcRuns = src
      .prepare(
        `SELECT id, driver_id, start_tick, finish_tick, cones, disposition
         FROM runs WHERE event_id = ? ORDER BY id`,
      )
      .all(srcEvent.id) as SrcRun[];

    const slug = `${srcEvent.event_date}-${slugify(srcEvent.event_name)}`;
    const eventDate = new Date(`${srcEvent.event_date}T00:00:00.000Z`);

    return await client.$transaction(async (tx) => {
      const existing = await tx.event.findUnique({ where: { slug } });

      if (existing && existing.axdbSha256 === sha) {
        const entries = await tx.entry.count({ where: { eventId: existing.id } });
        const runs = await tx.run.count({ where: { entry: { eventId: existing.id } } });
        return {
          status: "unchanged",
          event: { id: existing.id, slug: existing.slug, name: existing.name },
          counts: {
            classes: srcClasses.length,
            drivers: srcDrivers.length,
            entries,
            runs,
          },
        };
      }

      const event = existing
        ? await tx.event.update({
            where: { id: existing.id },
            data: { axdbSha256: sha, name: srcEvent.event_name, date: eventDate },
          })
        : await tx.event.create({
            data: { slug, name: srcEvent.event_name, date: eventDate, axdbSha256: sha },
          });

      if (existing) {
        await tx.entry.deleteMany({ where: { eventId: event.id } });
      }

      const classIdBySrc = new Map<number, number>();
      for (const c of srcClasses) {
        const appClass = await tx.carClass.upsert({
          where: { code: c.class_name },
          create: { code: c.class_name, paxIndex: c.pax },
          update: { paxIndex: c.pax },
        });
        classIdBySrc.set(c.id, appClass.id);
      }

      const driverIdBySrc = new Map<number, number>();
      for (const d of srcDrivers) {
        const memberNum = d.member_num?.trim() || null;
        const lastInitial = redactLastName(d.last_name);
        const appDriver = memberNum
          ? await tx.driver.upsert({
              where: { memberNum },
              create: {
                memberNum,
                firstName: d.first_name,
                lastInitial,
              },
              update: { firstName: d.first_name, lastInitial },
            })
          : await tx.driver.create({
              data: { firstName: d.first_name, lastInitial },
            });
        driverIdBySrc.set(d.id, appDriver.id);
      }

      const entryIdBySrcDriver = new Map<number, number>();
      for (const d of srcDrivers) {
        const classId = classIdBySrc.get(d.class_id);
        const paxClassId = classIdBySrc.get(d.paxmult_id);
        if (classId == null || paxClassId == null) {
          throw new Error(
            `Driver ${d.id} references unknown class (class_id=${d.class_id}, paxmult_id=${d.paxmult_id})`,
          );
        }
        const driverId = driverIdBySrc.get(d.id);
        if (driverId == null) throw new Error(`Missing driver mapping for source id ${d.id}`);

        const entry = await tx.entry.create({
          data: {
            eventId: event.id,
            driverId,
            classId,
            paxClassId,
            carNumber: d.number,
            carDescription: d.car_model,
          },
        });
        entryIdBySrcDriver.set(d.id, entry.id);
      }

      const runsByDriver = new Map<number, SrcRun[]>();
      for (const r of srcRuns) {
        const list = runsByDriver.get(r.driver_id) ?? [];
        list.push(r);
        runsByDriver.set(r.driver_id, list);
      }

      let runCount = 0;
      for (const [srcDriverId, list] of runsByDriver) {
        const entryId = entryIdBySrcDriver.get(srcDriverId);
        if (entryId == null) continue;
        list.sort((a, b) => a.id - b.id);
        let runNumber = 1;
        for (const r of list) {
          const disposition = toDisposition(r.disposition);
          const rawTimeMs =
            disposition === RunDisposition.DNF
              ? null
              : r.start_tick != null && r.finish_tick != null
                ? r.finish_tick - r.start_tick
                : null;
          await tx.run.create({
            data: {
              entryId,
              runNumber,
              rawTimeMs,
              cones: r.cones ?? 0,
              disposition,
            },
          });
          runNumber += 1;
          runCount += 1;
        }
      }

      return {
        status: "ingested",
        event: { id: event.id, slug: event.slug, name: event.name },
        counts: {
          classes: srcClasses.length,
          drivers: srcDrivers.length,
          entries: srcDrivers.length,
          runs: runCount,
        },
      };
    });
  } finally {
    src.close();
  }
}
