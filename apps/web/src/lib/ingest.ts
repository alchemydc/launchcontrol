import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import { resolveOrCreateSeason } from "@/lib/season-resolve";
import { redactLastName } from "./pii";
export { redactLastName };

export type IngestSummary = {
  status: "ingested" | "unchanged";
  event: { id: number; slug: string; name: string };
  counts: { classes: number; drivers: number; entries: number; runs: number };
  sourceSha256: string;
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
  status: number;
};
type SrcRegistration = {
  driver_id: number;
  bestcommittedrun_id: number | null;
};

const REQUIRED_TABLES = ["events", "classes", "drivers", "registrations", "runs"] as const;

// The deployment's league. PR 1 is single-league-per-deployment: this module-level
// env read is static in practice (one process, one deployment, one league) and is
// duplicated in league-config.ts's getLeagueConfig() for app-facing config; the
// season-resolution logic that used to live here is centralized in
// season-resolve.ts's resolveOrCreateSeason(), shared with admin-events.ts.
const DEFAULT_LEAGUE_SLUG = process.env.DEFAULT_LEAGUE_SLUG?.trim() || "pca-rmr";


export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildEventSlug(dateStr: string, name: string): string {
  return `${dateStr}-${slugify(name)}`;
}

function toDisposition(raw: string | null): RunDisposition {
  switch ((raw ?? "").trim().toUpperCase()) {
    case "":    return RunDisposition.CLEAN;
    case "DNF": return RunDisposition.DNF;
    case "RRN": return RunDisposition.RRN;
    case "OFF": return RunDisposition.OFF;
    case "DSQ": return RunDisposition.DSQ;
    default:
      throw new Error(`[ingest] unrecognized run disposition: ${JSON.stringify(raw)} — add to RunDisposition enum or investigate.`);
  }
}

export function computeIdentityHash(
  memberNum: string | null,
  firstName: string,
  lastName: string,
): string {
  const key = `${(memberNum ?? "").trim()}|${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}`;
  return createHash("sha256").update(key).digest("hex");
}

// Full-name-only key, independent of member_num. Used to self-heal legacy .axdb
// exports (e.g. the 2024 AxWare transition) where every driver row has a blank
// member_num, which would otherwise split one human into a distinct Driver per
// event. Never used as the primary identity — only to find merge/adopt
// candidates when an identityHash lookup misses (see the driver-resolution
// block below).
export function computeNameOnlyHash(firstName: string, lastName: string): string {
  const key = `${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}`;
  return createHash("sha256").update(key).digest("hex");
}

// VisualAX's post-AxWare-transition exports sometimes append a "verified" token
// to member_num (`"1234 verified"`, `"1234-verified"`) that isn't present on
// older exports of the same person. Left unstripped, this splits one human into
// multiple Driver rows. Strip it down to the base number before it ever reaches
// the identity hash or gets stored.
export function normalizeMemberNum(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const stripped = trimmed.replace(/[-\s]+verified$/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

export type IngestAxdbOptions = {
  /** Target league slug. Defaults to DEFAULT_LEAGUE_SLUG (unchanged single-league behavior). */
  leagueSlug?: string;
};

export async function ingestAxdb(
  path: string,
  client: PrismaClient = defaultClient,
  opts: IngestAxdbOptions = {},
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
        throw new Error(`Source DB is missing required table '${t}' — not an VisualAX .axdb`);
      }
    }

    const eventCount = (src.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
    if (eventCount > 1) {
      throw new Error(`Source .axdb contains ${eventCount} events; ingest supports single-event files only.`);
    }

    const srcEvent = src
      .prepare("SELECT id, event_name, event_date FROM events ORDER BY id LIMIT 1")
      .get() as SrcEvent | undefined;
    if (!srcEvent) throw new Error("Source .axdb contains no event row");

    const srcClasses = src
      .prepare("SELECT id, class_name, pax FROM classes ORDER BY id")
      .all() as SrcClass[];

    let srcDrivers = src
      .prepare(
        `SELECT d.id, d.first_name, d.last_name, d.number, d.class_id, d.paxmult_id,
                d.car_model, d.member_num
         FROM drivers d
         JOIN registrations r ON r.driver_id = d.id AND r.event_id = ?
         ORDER BY d.id`,
      )
      .all(srcEvent.id) as SrcDriver[];

    // Only status=3 (committed) runs represent scoreable results — see PRD §2.3 for
    // the full status lifecycle (0=pre-start queue, 1=on course, 2=post-finish queue,
    // 3=committed, 4=cancelled).
    const srcRuns = src
      .prepare(
        `SELECT id, driver_id, start_tick, finish_tick, cones, disposition, status
         FROM runs WHERE event_id = ? AND status = 3 ORDER BY id`,
      )
      .all(srcEvent.id) as SrcRun[];

    // Use bestcommittedrun_id (FK → runs.id) rather than bestcommittedrun_no because
    // VisualAX's run_no skips voided RRN slots while our sequential run numbering includes
    // them — making run_no unreliable as a lookup key.
    const srcRegistrations = src
      .prepare(`SELECT driver_id, bestcommittedrun_id FROM registrations WHERE event_id = ?`)
      .all(srcEvent.id) as SrcRegistration[];
    const committedRunIdByDriver = new Map<number, number | null>(
      srcRegistrations.map((r) => [r.driver_id, r.bestcommittedrun_id]),
    );

    // Skip ghost registrations: source `drivers` rows with zero `runs` rows.
    // VisualAX keeps a pre-registration row in place when a driver changes cars on race
    // day. Including ghosts would collide on (identityHash, classId) during entry
    // recovery. PCA Series export already ignores zero-run entries.
    // Note: ghost detection runs over the status=3-filtered set, so a driver whose
    // only runs were cancelled (status=4) is correctly classified as a ghost.
    const srcDriverIdsWithRuns = new Set(srcRuns.map((r) => r.driver_id));
    const ghostDrivers = srcDrivers.filter((d) => !srcDriverIdsWithRuns.has(d.id));
    if (ghostDrivers.length > 0) {
      console.warn(
        `[ingest] ${srcEvent.event_name}: skipping ${ghostDrivers.length} ghost driver row(s) with zero runs:`,
        ghostDrivers
          .map((d) => `${d.first_name} ${d.last_name.charAt(0)}. #${d.number}`)
          .join(", "),
      );
      srcDrivers = srcDrivers.filter((d) => srcDriverIdsWithRuns.has(d.id));
    }

    const slug = buildEventSlug(srcEvent.event_date, srcEvent.event_name);
    const eventDate = new Date(`${srcEvent.event_date}T00:00:00.000Z`);

    return await client.$transaction(async (tx) => {
      // Resolve the target League → Season for this event. The league is seeded by
      // the league-foundation migration; a missing league means the DB was never
      // migrated. The Season is resolved by (league, event year) — auto-created
      // (login-less self-heal — seasons otherwise come from seeds or
      // `pnpm --filter web season:create`) if none exists — via the shared
      // resolveOrCreateSeason(), also used by admin-events.ts's cross-year
      // re-resolution on a date edit.
      const leagueSlug = opts.leagueSlug?.trim() || DEFAULT_LEAGUE_SLUG;
      const league = await tx.league.findUnique({ where: { slug: leagueSlug } });
      if (!league) {
        throw new Error(
          `[ingest] league '${leagueSlug}' not found — check --league, or run 'prisma migrate deploy' ` +
            `to seed the default league (or 'pnpm --filter web league:create' for a new one).`,
        );
      }
      const eventYear = eventDate.getUTCFullYear();
      const season = await resolveOrCreateSeason(tx, league, eventYear);
      const seasonId = season.id;

      const existing = await tx.event.findUnique({
        where: { seasonId_slug: { seasonId, slug } },
      });

      if (existing && existing.sourceSha256 === sha) {
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
          sourceSha256: sha,
        };
      }

      const event = existing
        ? await tx.event.update({
            where: { id: existing.id },
            data: { sourceSha256: sha, name: srcEvent.event_name, date: eventDate },
          })
        : await tx.event.create({
            data: { seasonId, slug, name: srcEvent.event_name, date: eventDate, sourceSha256: sha },
          });

      if (existing) {
        await tx.entry.deleteMany({ where: { eventId: event.id } });
      }

      // CarClass: findMany existing, createMany new, update only paxIndex-changed rows, findMany to map IDs.
      const srcClassCodes = srcClasses.map((c) => c.class_name);
      const existingClasses = await tx.carClass.findMany({
        where: { leagueId: league.id, code: { in: srcClassCodes } },
      });
      const existingClassByCode = new Map(existingClasses.map((c) => [c.code, c]));

      const newClassData = srcClasses
        .filter((c) => !existingClassByCode.has(c.class_name))
        .map((c) => ({ leagueId: league.id, code: c.class_name, paxIndex: c.pax }));
      if (newClassData.length > 0) {
        await tx.carClass.createMany({ data: newClassData });
      }
      for (const c of srcClasses) {
        const cur = existingClassByCode.get(c.class_name);
        if (cur && Number(cur.paxIndex) !== c.pax) {
          await tx.carClass.update({ where: { id: cur.id }, data: { paxIndex: c.pax } });
        }
      }
      const allClasses = await tx.carClass.findMany({
        where: { leagueId: league.id, code: { in: srcClassCodes } },
      });
      const classIdByCode = new Map(allClasses.map((c) => [c.code, c.id]));
      const classIdBySrc = new Map<number, number>();
      for (const c of srcClasses) {
        const id = classIdByCode.get(c.class_name);
        if (id == null) throw new Error(`Failed to resolve class id for code '${c.class_name}'`);
        classIdBySrc.set(c.id, id);
      }

      // Driver: identity is `(memberNum, firstName, lastName)` hashed. VisualAX's member_num
      // is family/account-level — multiple distinct humans can share one, and co-drivers
      // may either share the primary's member_num or have an empty member_num. member_num is
      // normalized (verified-suffix stripped, see normalizeMemberNum above) before hashing,
      // so the same person's differing raw forms across exports still collapse to one
      // identity. Hashing the full last_name lets us cross-link the same human across
      // events while still persisting only the redacted lastInitial (see redactLastName above).
      //
      // Legacy .axdb exports (e.g. the 2024 AxWare transition) carry a blank member_num for
      // every driver, so identityHash alone would split one human into one Driver row per
      // event. When an identityHash lookup misses, nameOnlyHash (full-name-only, see
      // computeNameOnlyHash above) finds merge/adopt candidates instead:
      //   - a blank-member row merges into the single populated Driver sharing its name
      //     (no new row) — self-healing the legacy files as they're ingested.
      //   - a populated row "adopts" a single pre-existing blank-member Driver sharing its
      //     name, updating it in place — so a later, better-identified export of the same
      //     legacy-era human still lands on the same row.
      // Both only fire when there is EXACTLY ONE candidate; 0 or ≥2 leaves the status quo
      // (a new, separate Driver row) rather than guessing.
      type DriverIdentity = {
        identityHash: string;
        memberNum: string | null;
        firstName: string;
        lastInitial: string;
        nameOnlyHash: string;
      };
      const driverHashBySrc = new Map<number, string>();
      const uniqueDriverIdentities = new Map<string, DriverIdentity>();
      for (const d of srcDrivers) {
        const memberNum = normalizeMemberNum(d.member_num);
        const identityHash = computeIdentityHash(memberNum, d.first_name, d.last_name);
        driverHashBySrc.set(d.id, identityHash);
        // Last write wins on duplicate identityHash within one source — mirrors the
        // original upsert's "update on second sight" behavior.
        uniqueDriverIdentities.set(identityHash, {
          identityHash,
          memberNum,
          firstName: d.first_name,
          lastInitial: redactLastName(d.last_name),
          nameOnlyHash: computeNameOnlyHash(d.first_name, d.last_name),
        });
      }

      const driverIdBySrc = new Map<number, number>();

      if (uniqueDriverIdentities.size > 0) {
        const identityHashes = Array.from(uniqueDriverIdentities.keys());
        const nameOnlyHashes = Array.from(
          new Set(Array.from(uniqueDriverIdentities.values(), (i) => i.nameOnlyHash)),
        );
        // Sequential on purpose: parallel queries on an interactive-transaction client
        // share one connection and can abort the transaction (Prisma guidance).
        const existingByIdentityHash = await tx.driver.findMany({
          where: { identityHash: { in: identityHashes } },
        });
        const existingByNameOnlyHash = await tx.driver.findMany({
          where: { nameOnlyHash: { in: nameOnlyHashes } },
        });
        const existingByHash = new Map(existingByIdentityHash.map((d) => [d.identityHash, d]));

        // identityHash → resolved app Driver id. Populated identities are resolved (updated,
        // adopted, or created) before blank ones so a blank identity's merge-candidate search
        // can see the id of an in-file populated driver this same pass just created.
        const resolvedIdByIdentity = new Map<string, number>();
        const populatedMisses: Array<[string, DriverIdentity]> = [];
        const blankMisses: Array<[string, DriverIdentity]> = [];

        for (const [hash, info] of uniqueDriverIdentities) {
          const cur = existingByHash.get(hash);
          if (!cur) {
            (info.memberNum == null ? blankMisses : populatedMisses).push([hash, info]);
            continue;
          }
          if (
            cur.firstName !== info.firstName ||
            cur.lastInitial !== info.lastInitial ||
            cur.memberNum !== info.memberNum ||
            cur.nameOnlyHash !== info.nameOnlyHash
          ) {
            await tx.driver.update({
              where: { id: cur.id },
              data: {
                firstName: info.firstName,
                lastInitial: info.lastInitial,
                memberNum: info.memberNum,
                nameOnlyHash: info.nameOnlyHash,
              },
            });
          }
          resolvedIdByIdentity.set(hash, cur.id);
        }

        // Populated, identityHash miss: adopt-forward into a pre-existing blank-member Driver
        // sharing the full-name key, else create. A blank Driver's identityHash is unique, so
        // at most one can share a nameOnlyHash — the ambiguity guard only needs to rule out
        // OTHER populated rows/identities sharing that same name.
        const populatedCreateData: DriverIdentity[] = [];
        for (const [hash, info] of populatedMisses) {
          const blankCandidate = existingByNameOnlyHash.find(
            (d) => d.nameOnlyHash === info.nameOnlyHash && d.memberNum == null,
          );
          const otherPopulatedInDb = existingByNameOnlyHash.some(
            (d) => d.nameOnlyHash === info.nameOnlyHash && d.memberNum != null,
          );
          const otherPopulatedInFile = Array.from(uniqueDriverIdentities.entries()).some(
            ([otherHash, otherInfo]) =>
              otherHash !== hash &&
              otherInfo.memberNum != null &&
              otherInfo.nameOnlyHash === info.nameOnlyHash,
          );
          if (blankCandidate && !otherPopulatedInDb && !otherPopulatedInFile) {
            await tx.driver.update({
              where: { id: blankCandidate.id },
              data: {
                memberNum: info.memberNum,
                identityHash: info.identityHash,
                firstName: info.firstName,
                lastInitial: info.lastInitial,
                nameOnlyHash: info.nameOnlyHash,
              },
            });
            resolvedIdByIdentity.set(hash, blankCandidate.id);
          } else {
            populatedCreateData.push(info);
          }
        }
        if (populatedCreateData.length > 0) {
          await tx.driver.createMany({ data: populatedCreateData });
          const created = await tx.driver.findMany({
            where: { identityHash: { in: populatedCreateData.map((i) => i.identityHash) } },
          });
          for (const d of created) resolvedIdByIdentity.set(d.identityHash, d.id);
        }

        // Blank, identityHash miss: merge into the single populated Driver sharing the
        // full-name key — either resolved above (this file or already in the DB) — else
        // create a new name-only Driver row (status quo, e.g. an ambiguous shared name).
        const blankCreateData: DriverIdentity[] = [];
        for (const [hash, info] of blankMisses) {
          const candidateIds = new Set<number>();
          for (const [otherHash, otherInfo] of uniqueDriverIdentities) {
            if (otherHash === hash || otherInfo.memberNum == null) continue;
            if (otherInfo.nameOnlyHash !== info.nameOnlyHash) continue;
            const id = resolvedIdByIdentity.get(otherHash);
            if (id != null) candidateIds.add(id);
          }
          for (const d of existingByNameOnlyHash) {
            if (d.memberNum != null && d.nameOnlyHash === info.nameOnlyHash) candidateIds.add(d.id);
          }
          if (candidateIds.size === 1) {
            const [onlyId] = candidateIds;
            resolvedIdByIdentity.set(hash, onlyId!);
          } else {
            blankCreateData.push(info);
          }
        }
        if (blankCreateData.length > 0) {
          await tx.driver.createMany({ data: blankCreateData });
          const created = await tx.driver.findMany({
            where: { identityHash: { in: blankCreateData.map((i) => i.identityHash) } },
          });
          for (const d of created) resolvedIdByIdentity.set(d.identityHash, d.id);
        }

        for (const [srcId, hash] of driverHashBySrc) {
          const id = resolvedIdByIdentity.get(hash);
          if (id == null) {
            throw new Error(`Failed to resolve driver id for identity hash '${hash.slice(0, 12)}…'`);
          }
          driverIdBySrc.set(srcId, id);
        }
      }

      // Entry: bulk createMany, then findMany to map back by (driverId, classId).
      // VisualAX gives each (human, class) pair its own driver row, so two source driver
      // rows can map to the same app Driver (e.g. one human entered in two classes via
      // two VisualAX rows). The composite (driverId, classId) is unique per event and is
      // the right recovery key; driverId alone would silently collapse.
      const entriesData = srcDrivers.map((d) => {
        const classId = classIdBySrc.get(d.class_id);
        const paxClassId = classIdBySrc.get(d.paxmult_id);
        if (classId == null || paxClassId == null) {
          throw new Error(
            `Driver ${d.id} references unknown class (class_id=${d.class_id}, paxmult_id=${d.paxmult_id})`,
          );
        }
        const driverId = driverIdBySrc.get(d.id);
        if (driverId == null) throw new Error(`Missing driver mapping for source id ${d.id}`);
        // Resolve the committed run ID to an app run number.
        // VisualAX's bestcommittedrun_no skips voided RRN slots; we use the FK (run id)
        // to find the sequential position in our sorted-by-id run numbering instead.
        const committedSrcRunId = committedRunIdByDriver.get(d.id) ?? null;
        const driverRunIds = srcRuns
          .filter((r) => r.driver_id === d.id)
          .sort((a, b) => a.id - b.id)
          .map((r) => r.id);
        const committedIdx = committedSrcRunId != null
          ? driverRunIds.indexOf(committedSrcRunId)
          : -1;
        const bestCommittedRunNumber = committedIdx >= 0 ? committedIdx + 1 : null;

        return {
          eventId: event.id,
          driverId,
          classId,
          paxClassId,
          carNumber: d.number,
          carDescription: d.car_model,
          bestCommittedRunNumber,
        };
      });
      if (entriesData.length > 0) {
        await tx.entry.createMany({ data: entriesData });
      }

      const newEntries = await tx.entry.findMany({ where: { eventId: event.id } });
      const entryIdByDriverAndClass = new Map<string, number>();
      for (const e of newEntries) {
        const key = `${e.driverId}:${e.classId}`;
        if (entryIdByDriverAndClass.has(key)) {
          throw new Error(
            `Multiple entries for driver ${e.driverId} in class ${e.classId} at event ${event.id} — data anomaly`,
          );
        }
        entryIdByDriverAndClass.set(key, e.id);
      }
      const entryIdBySrcDriver = new Map<number, number>();
      for (const d of srcDrivers) {
        const driverId = driverIdBySrc.get(d.id)!;
        const classId = classIdBySrc.get(d.class_id)!;
        const entryId = entryIdByDriverAndClass.get(`${driverId}:${classId}`);
        if (entryId == null) throw new Error(`Missing entry for source driver ${d.id}`);
        entryIdBySrcDriver.set(d.id, entryId);
      }

      // Run: flatten per-driver source runs into one array, then a single createMany.
      const runsByDriver = new Map<number, SrcRun[]>();
      for (const r of srcRuns) {
        const list = runsByDriver.get(r.driver_id) ?? [];
        list.push(r);
        runsByDriver.set(r.driver_id, list);
      }

      const runsData: Array<{
        entryId: number;
        runNumber: number;
        rawTimeMs: number | null;
        cones: number;
        disposition: RunDisposition;
      }> = [];
      for (const [srcDriverId, list] of runsByDriver) {
        const entryId = entryIdBySrcDriver.get(srcDriverId);
        if (entryId == null) continue;
        list.sort((a, b) => a.id - b.id);
        let runNumber = 1;
        for (const r of list) {
          const disposition = toDisposition(r.disposition);
          const rawTimeMs =
            disposition === RunDisposition.DNF || disposition === RunDisposition.OFF
              ? null
              : r.start_tick != null && r.finish_tick != null
                ? r.finish_tick - r.start_tick
                : null;
          runsData.push({
            entryId,
            runNumber,
            rawTimeMs,
            cones: r.cones ?? 0,
            disposition,
          });
          runNumber += 1;
        }
      }
      if (runsData.length > 0) {
        await tx.run.createMany({ data: runsData });
      }

      return {
        status: "ingested",
        event: { id: event.id, slug: event.slug, name: event.name },
        counts: {
          classes: srcClasses.length,
          drivers: srcDrivers.length,
          entries: srcDrivers.length,
          runs: runsData.length,
        },
        sourceSha256: sha,
      };
    });
  } finally {
    src.close();
  }
}
