import { PrismaClient, RunDisposition } from "@/generated/prisma/client";
import { prisma as defaultClient } from "@/lib/prisma";
import {
  buildEventSlug,
  computeIdentityHash,
  computeNameOnlyHash,
  redactLastName,
  type IngestSummary,
} from "@/lib/ingest";
import { resolveOrCreateSeason } from "@/lib/season-resolve";
import { nearestPaxClass, parseSeasonPaxTable, resolveSeasonPaxIndex } from "@/lib/rmsolo-pax";
import { reconcileTimes, type ParsedEntry, type ParsedRmsoloEvent, type ParsedRun } from "@/lib/rmsolo-parse";

const CONE_SECONDS = 2.0;
const EPS = 0.0005;

// The deployment's default league when no --league / leagueSlug is given —
// same env var and fallback as ingest.ts's DEFAULT_LEAGUE_SLUG (PR 1's single
// tenant-selecting knob), duplicated here rather than imported so this module
// has no import-time dependency on ingest.ts beyond its named helpers.
const DEFAULT_LEAGUE_SLUG = process.env.DEFAULT_LEAGUE_SLUG?.trim() || "pca-rmr";

export type RmsoloIngestInput = {
  parsed: ParsedRmsoloEvent;
  sha256: string;
  /** Event date from the results index page (the PDF itself has no date). */
  date: string; // YYYY-MM-DD
  /** Optional display-name override; defaults to a normalized parsed.title ("Summer 2026#1" → "Summer 2026 #1"). */
  name?: string;
  /** Target league slug. Defaults to DEFAULT_LEAGUE_SLUG (single-league behavior, unchanged). */
  leagueSlug?: string;
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
  const leagueSlug = input.leagueSlug?.trim() || DEFAULT_LEAGUE_SLUG;
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

  // Run-group sections (M/N/S/P/X) print a PAX-indexed Best but never the
  // driver's underlying class. The applied factor is recoverable as
  // printedBest / bestPenalizedRaw, and nearestPaxClass maps it back to the
  // class it belongs to — giving the entry its true paxClass while the
  // entered class remains the run group (mirroring the .axdb class/paxmult
  // split this schema was built for). Entries whose factor matches nothing
  // in the table keep paxClass = entered class (factor 1.0 fallback). This
  // matching is against the built-in RMSOLO_PAX_2026 table only — a season's
  // paxTable override doesn't affect WHICH class a derived factor maps to,
  // only the numeric paxIndex ultimately stored for that class (below).
  const derivedPaxCodeByEntry = new Map<ParsedEntry, string>();
  for (const e of unreconciled) {
    // Only run-group section headings (single letters: M/N/S/P/X) print
    // indexed Bests; real classes are >=2 chars. Without this gate, any
    // unreconciled normal-class entry (e.g. a printing glitch) whose
    // best/raw ratio lands near a table factor would silently get a
    // mislabeled paxClass — notably AM (1.000) for near-1.0 ratios.
    if (!/^[A-Z]$/.test(e.classCode)) continue;
    if (e.bestSeconds == null) continue;
    const clean = e.runs.filter((r) => r.disposition === "CLEAN");
    if (clean.length === 0) continue;
    const minPenal = Math.min(...clean.map(penalizedTotal));
    const match = nearestPaxClass(e.bestSeconds / minPenal);
    if (match) derivedPaxCodeByEntry.set(e, match.code);
  }

  return await client.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { slug: leagueSlug } });
    if (!league) {
      throw new Error(
        `[rmsolo-ingest] league '${leagueSlug}' not found — check --league, or run 'prisma migrate deploy' ` +
          `to seed the default league (or 'pnpm --filter web league:create' for a new one).`,
      );
    }
    const eventYear = eventDate.getUTCFullYear();
    const season = await resolveOrCreateSeason(tx, league, eventYear);
    const seasonId = season.id;
    const seasonPaxTable = parseSeasonPaxTable(season.paxTable);

    const existing = await tx.event.findUnique({ where: { seasonId_slug: { seasonId, slug } } });

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
          data: { seasonId, slug, name, date: eventDate, sourceSha256: sha256 },
        });

    if (existing) {
      await tx.entry.deleteMany({ where: { eventId: event.id } });
    }

    // CarClass: league-scoped (findMany existing, createMany new, update only
    // paxIndex-changed rows, findMany to map IDs). Includes classes referenced
    // only as a derived paxClass (see derivedPaxCodeByEntry).
    const classCodes = Array.from(
      new Set([...parsed.classCodes, ...derivedPaxCodeByEntry.values()]),
    );
    const existingClasses = await tx.carClass.findMany({
      where: { leagueId: league.id, code: { in: classCodes } },
    });
    const existingClassByCode = new Map(existingClasses.map((c) => [c.code, c]));

    const newClassData = classCodes
      .filter((code) => !existingClassByCode.has(code))
      .map((code) => ({ leagueId: league.id, code, paxIndex: resolveSeasonPaxIndex(code, seasonPaxTable) }));
    if (newClassData.length > 0) {
      await tx.carClass.createMany({ data: newClassData });
    }
    for (const code of classCodes) {
      const cur = existingClassByCode.get(code);
      const pax = resolveSeasonPaxIndex(code, seasonPaxTable);
      if (cur && Number(cur.paxIndex) !== pax) {
        await tx.carClass.update({ where: { id: cur.id }, data: { paxIndex: pax } });
      }
    }
    const allClasses = await tx.carClass.findMany({
      where: { leagueId: league.id, code: { in: classCodes } },
    });
    const classIdByCode = new Map(allClasses.map((c) => [c.code, c.id]));

    // Driver: PCA PII posture applies to every source (project decision,
    // 2026-07-22) — the full lastName is HASHED for identity but never
    // stored; only the redacted lastInitial persists. Anonymous entries are
    // the one exception to the "single letter + period" initial format:
    // they store their car-number label ("#33") so they render as
    // "Unknown #33". All RMsolo drivers have a null memberNum, so
    // identityHash is effectively name-keyed already — no blank-member
    // merge/adopt machinery needed (unlike ingestAxdb's .axdb path). Drivers
    // are NOT league-scoped (a human can drive in multiple leagues; see
    // driver-history's cross-league aggregation, Task 6) — same as ingestAxdb.
    type DriverIdentity = {
      identityHash: string;
      firstName: string;
      lastInitial: string;
      nameOnlyHash: string;
    };
    const identityByEntry = new Map<ParsedEntry, string>();
    const uniqueDriverIdentities = new Map<string, DriverIdentity>();
    for (const e of parsed.entries) {
      const anonymous = e.firstName.trim() === "" && e.lastName.trim() === "";
      const { firstName, lastName } = identityNameFor(e);
      const identityHash = computeIdentityHash(null, firstName, lastName);
      identityByEntry.set(e, identityHash);
      // Last write wins on duplicate identityHash within one source.
      uniqueDriverIdentities.set(identityHash, {
        identityHash,
        firstName,
        lastInitial: anonymous ? lastName : redactLastName(lastName),
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
          cur.nameOnlyHash !== info.nameOnlyHash
        ) {
          await tx.driver.update({
            where: { id: cur.id },
            data: {
              firstName: info.firstName,
              lastInitial: info.lastInitial,
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
      const paxCode = derivedPaxCodeByEntry.get(e) ?? e.classCode;
      const paxClassId = classIdByCode.get(paxCode);
      if (paxClassId == null) throw new Error(`Entry references unknown pax class code '${paxCode}'`);
      // Snapshot the factor in force at ingest. resolveSeasonPaxIndex(paxCode)
      // is exactly what set CarClass.paxIndex for paxCode's class above, so
      // Entry.paxClass.paxIndex === Entry.paxIndexApplied now — they diverge
      // only if the CarClass is later edited. Covers both paths: the derived
      // run-group class (paxCode from nearestPaxClass) and the fallback where
      // paxCode = entered class (no match → the class's own factor, 1.0 for a
      // bare run-group heading).
      const paxIndexApplied = resolveSeasonPaxIndex(paxCode, seasonPaxTable);
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
        paxClassId,
        paxIndexApplied,
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
          paxIndexApplied: e.paxIndexApplied,
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
