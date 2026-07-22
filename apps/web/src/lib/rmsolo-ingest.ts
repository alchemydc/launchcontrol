import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import {
  buildEventSlug,
  computeIdentityHash,
  computeNameOnlyHash,
  redactLastName,
  type IngestSummary,
} from "@/lib/ingest";
import { getRmsoloPaxIndex } from "@/lib/rmsolo-pax";
import { reconcileTimes, type ParsedEntry, type ParsedRmsoloEvent, type ParsedRun } from "@/lib/rmsolo-parse";

const CONE_SECONDS = 2.0;
const EPS = 0.0005;

export type RmsoloIngestInput = {
  parsed: ParsedRmsoloEvent;
  sha256: string;
  /** Event date from the results index page (the PDF itself has no date). */
  date: string; // YYYY-MM-DD
  /** Optional display-name override; defaults to a normalized parsed.title ("Summer 2026#1" → "Summer 2026 #1"). */
  name?: string;
};

function toDisposition(raw: ParsedRun["disposition"]): RunDisposition {
  switch (raw) {
    case "CLEAN":
      return RunDisposition.CLEAN;
    case "DNF":
      return RunDisposition.DNF;
    default:
      throw new Error(`[rmsolo-ingest] unrecognized run disposition: ${JSON.stringify(raw)}`);
  }
}

// Real RMsolo Full PDFs contain genuine "blank co-drive placeholder" rows —
// entries with a car number and a full run set but NO name, car description,
// or hometown printed at all (confirmed byte-for-byte against source PDFs,
// not a tokenizer artifact). They are real results and must ingest — official
// leaderboards include them — so each is given a synthetic, car-number-keyed
// identity ("Unknown", "#<carNumber>") before hashing/storage, rather than
// being dropped or (as they were before this) all colliding onto one shared
// "blank name" driver identity, which broke the (driverId, classId)
// uniqueness invariant whenever two blank entries landed in the same class.
// Cross-event linkage of anonymous drivers by car number is a best-effort
// assumption (a number can be reassigned to a different anonymous entrant
// across seasons) — acceptable since there is no other identifying data.
function identityNameFor(e: Pick<ParsedEntry, "firstName" | "lastName" | "carNumber">): {
  firstName: string;
  lastName: string;
} {
  if (e.firstName.trim() === "" && e.lastName.trim() === "") {
    return { firstName: "Unknown", lastName: `#${e.carNumber}` };
  }
  return { firstName: e.firstName, lastName: e.lastName };
}

export async function ingestRmsoloEvent(
  input: RmsoloIngestInput,
  client: PrismaClient = defaultClient,
): Promise<IngestSummary> {
  const { parsed, sha256, date } = input;
  const { interpretation, unreconciled } = reconcileTimes(parsed);
  const unreconciledSet = new Set(unreconciled);
  const anonymousCount = parsed.entries.filter(
    (e) => e.firstName.trim() === "" && e.lastName.trim() === "",
  ).length;
  if (anonymousCount > 0) {
    console.warn(
      `[rmsolo-ingest] ${anonymousCount} entr${anonymousCount === 1 ? "y" : "ies"} printed no driver name — ingested as "Unknown #<carNumber>"`,
    );
  }
  if (unreconciled.length > 0) {
    // One summary line per event, not per entry — real "run-group" headings
    // (M/N/S/P/X; see rmsolo-pax.ts) can carry many PAX-indexed entries and we
    // don't want to flood logs with one warning each.
    const listed = unreconciled
      .map((e) => {
        const { firstName, lastName } = identityNameFor(e);
        return `${e.classCode}/${firstName} ${lastName}`;
      })
      .join(", ");
    console.warn(
      `[rmsolo-ingest] ${unreconciled.length} entr${unreconciled.length === 1 ? "y" : "ies"} could not reconcile printed Best against ${interpretation} run times (bestCommittedRunNumber left null): ${listed}`,
    );
  }
  const name = input.name ?? parsed.title.replace(/#/, " #").replace(/\s+/g, " ").trim();
  const slug = buildEventSlug(date, name);
  const eventDate = new Date(`${date}T00:00:00.000Z`);

  // rawSeconds: what we persist as rawTimeMs (truly raw, pre-penalty).
  const rawSeconds = (r: ParsedRun): number =>
    interpretation === "raw" ? r.seconds : r.seconds - r.cones * CONE_SECONDS;
  // penalizedTotal: what the printed "Best" column represents — used to locate
  // bestCommittedRunNumber regardless of which interpretation the source used.
  const penalizedTotal = (r: ParsedRun): number => rawSeconds(r) + r.cones * CONE_SECONDS;

  return await client.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({ where: { slug } });

    if (existing && existing.sourceSha256 === sha256) {
      const entries = await tx.entry.count({ where: { eventId: existing.id } });
      const runs = await tx.run.count({ where: { entry: { eventId: existing.id } } });
      const distinctDrivers = await tx.entry.findMany({
        where: { eventId: existing.id },
        distinct: ["driverId"],
        select: { driverId: true },
      });
      return {
        status: "unchanged",
        event: { id: existing.id, slug: existing.slug, name: existing.name },
        counts: {
          classes: parsed.classCodes.length,
          drivers: distinctDrivers.length,
          entries,
          runs,
        },
        sourceSha256: sha256,
      };
    }

    const event = existing
      ? await tx.event.update({
          where: { id: existing.id },
          data: { sourceSha256: sha256, name, date: eventDate },
        })
      : await tx.event.create({
          data: { slug, name, date: eventDate, sourceSha256: sha256 },
        });

    if (existing) {
      await tx.entry.deleteMany({ where: { eventId: event.id } });
    }

    // CarClass: findMany existing, createMany new, update only paxIndex-changed rows, findMany to map IDs.
    const classCodes = parsed.classCodes;
    const existingClasses = await tx.carClass.findMany({ where: { code: { in: classCodes } } });
    const existingClassByCode = new Map(existingClasses.map((c) => [c.code, c]));

    const newClassData = classCodes
      .filter((code) => !existingClassByCode.has(code))
      .map((code) => ({ code, paxIndex: getRmsoloPaxIndex(code) }));
    if (newClassData.length > 0) {
      await tx.carClass.createMany({ data: newClassData });
    }
    for (const code of classCodes) {
      const cur = existingClassByCode.get(code);
      const pax = getRmsoloPaxIndex(code);
      if (cur && Number(cur.paxIndex) !== pax) {
        await tx.carClass.update({ where: { id: cur.id }, data: { paxIndex: pax } });
      }
    }
    const allClasses = await tx.carClass.findMany({ where: { code: { in: classCodes } } });
    const classIdByCode = new Map(allClasses.map((c) => [c.code, c.id]));

    // Driver: RMsolo results are public, so we store the full lastName (not just the
    // redacted initial). All RMsolo drivers have a null memberNum, so identityHash is
    // effectively name-keyed already — no blank-member merge/adopt machinery needed
    // (unlike ingestAxdb's .axdb path).
    type DriverIdentity = {
      identityHash: string;
      firstName: string;
      lastName: string;
      lastInitial: string;
      nameOnlyHash: string;
    };
    const identityByEntry = new Map<ParsedEntry, string>();
    const uniqueDriverIdentities = new Map<string, DriverIdentity>();
    for (const e of parsed.entries) {
      const { firstName, lastName } = identityNameFor(e);
      const identityHash = computeIdentityHash(null, firstName, lastName);
      identityByEntry.set(e, identityHash);
      // Last write wins on duplicate identityHash within one source.
      uniqueDriverIdentities.set(identityHash, {
        identityHash,
        firstName,
        lastName,
        lastInitial: redactLastName(lastName),
        nameOnlyHash: computeNameOnlyHash(firstName, lastName),
      });
    }

    const driverIdByIdentity = new Map<string, number>();
    if (uniqueDriverIdentities.size > 0) {
      const identityHashes = Array.from(uniqueDriverIdentities.keys());
      // Sequential on purpose: parallel queries on an interactive-transaction client
      // share one connection and can abort the transaction (Prisma guidance).
      const existingByIdentityHash = await tx.driver.findMany({
        where: { identityHash: { in: identityHashes } },
      });
      const existingByHash = new Map(existingByIdentityHash.map((d) => [d.identityHash, d]));

      const createData: DriverIdentity[] = [];
      for (const [hash, info] of uniqueDriverIdentities) {
        const cur = existingByHash.get(hash);
        if (!cur) {
          createData.push(info);
          continue;
        }
        if (
          cur.firstName !== info.firstName ||
          cur.lastInitial !== info.lastInitial ||
          cur.lastName !== info.lastName ||
          cur.nameOnlyHash !== info.nameOnlyHash
        ) {
          await tx.driver.update({
            where: { id: cur.id },
            data: {
              firstName: info.firstName,
              lastInitial: info.lastInitial,
              lastName: info.lastName,
              nameOnlyHash: info.nameOnlyHash,
            },
          });
        }
        driverIdByIdentity.set(hash, cur.id);
      }
      if (createData.length > 0) {
        await tx.driver.createMany({
          data: createData.map((info) => ({ ...info, memberNum: null })),
        });
        const created = await tx.driver.findMany({
          where: { identityHash: { in: createData.map((i) => i.identityHash) } },
        });
        for (const d of created) driverIdByIdentity.set(d.identityHash, d.id);
      }
    }

    // Entry: bulk createMany, then findMany to map back by (driverId, classId).
    // The same driver name can appear in two classes (multi-class entries) — the
    // composite (driverId, classId) key handles this correctly.
    const entriesData = parsed.entries.map((e) => {
      const classId = classIdByCode.get(e.classCode);
      if (classId == null) throw new Error(`Entry references unknown class code '${e.classCode}'`);
      const identityHash = identityByEntry.get(e)!;
      const driverId = driverIdByIdentity.get(identityHash);
      if (driverId == null) throw new Error(`Missing driver mapping for identity hash '${identityHash.slice(0, 12)}…'`);

      // Unreconciled entries (e.g. a PAX-indexed run-group Best — see
      // reconcileTimes) leave bestCommittedRunNumber null; downstream best-time
      // logic already falls back to min over CLEAN runs of (rawTimeMs +
      // cones*penalty), which is correct here since the stored run times
      // themselves remain raw regardless of what the source printed as Best.
      const bestCommittedRunNumber =
        e.bestSeconds == null || unreconciledSet.has(e)
          ? null
          : (() => {
              const idx = e.runs.findIndex(
                (r) => r.disposition === "CLEAN" && Math.abs(penalizedTotal(r) - e.bestSeconds!) < EPS,
              );
              return idx >= 0 ? idx + 1 : null;
            })();

      return {
        eventId: event.id,
        driverId,
        classId,
        paxClassId: classId,
        carNumber: e.carNumber,
        carDescription: e.carDescription,
        bestCommittedRunNumber,
        _entry: e,
      };
    });

    if (entriesData.length > 0) {
      await tx.entry.createMany({
        data: entriesData.map((e) => ({
          eventId: e.eventId,
          driverId: e.driverId,
          classId: e.classId,
          paxClassId: e.paxClassId,
          carNumber: e.carNumber,
          carDescription: e.carDescription,
          bestCommittedRunNumber: e.bestCommittedRunNumber,
        })),
      });
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

    // Run: flatten per-entry parsed runs into one array, then a single createMany.
    const runsData: Array<{
      entryId: number;
      runNumber: number;
      rawTimeMs: number | null;
      cones: number;
      disposition: RunDisposition;
    }> = [];
    for (const { driverId, classId, _entry } of entriesData) {
      const entryId = entryIdByDriverAndClass.get(`${driverId}:${classId}`);
      if (entryId == null) throw new Error(`Missing entry for driver ${driverId} in class ${classId}`);
      let runNumber = 1;
      for (const r of _entry.runs) {
        const disposition = toDisposition(r.disposition);
        const rawTimeMs = disposition === RunDisposition.CLEAN ? Math.round(rawSeconds(r) * 1000) : null;
        runsData.push({
          entryId,
          runNumber,
          rawTimeMs,
          cones: r.cones,
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
        classes: classCodes.length,
        drivers: uniqueDriverIdentities.size,
        entries: entriesData.length,
        runs: runsData.length,
      },
      sourceSha256: sha256,
    };
  });
}
