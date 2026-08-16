import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { computeIdentityHash, computeNameOnlyHash, redactLastName } from "@/lib/ingest";
import { ingestRmsoloEvent } from "@/lib/rmsolo-ingest";
import type { ParsedEntry, ParsedRmsoloEvent } from "@/lib/rmsolo-parse";
import { dbTarget, migrateDeploy } from "./helpers/db";

// Cross-source driver identity: an RMsolo PDF never prints a member number, so
// every entry it parses is blank-member. The .axdb/MSR path attaches a member
// number to the SAME shared Driver row (drivers are not league-scoped) and
// recomputes identityHash to the member-inclusive value, so a blank-member
// identityHash can no longer find that person. Without a nameOnlyHash fallback
// the RMsolo ingest mints a second Driver row and splits the human's history.
//
// All names and member numbers below are synthetic.
const { path: TEST_DB_PATH, url: TEST_DB_URL } = dbTarget("rmsolo-driver-identity");

let prisma: PrismaClient;

beforeAll(() => {
  rmSync(TEST_DB_PATH, { force: true });
  migrateDeploy(TEST_DB_URL);
  const adapter = new PrismaLibSql({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB_PATH, { force: true });
});

/**
 * The Driver row the .axdb/MSR path leaves behind for a member: memberNum
 * populated, identityHash folding that memberNum in, nameOnlyHash keyed on the
 * full name. Built with the same exported helpers ingestAxdb itself uses, so
 * the seeded shape cannot drift from the real one.
 */
function seedMemberDriver(firstName: string, lastName: string, memberNum: string) {
  return prisma.driver.create({
    data: {
      firstName,
      lastInitial: redactLastName(lastName),
      memberNum,
      identityHash: computeIdentityHash(memberNum, firstName, lastName),
      nameOnlyHash: computeNameOnlyHash(firstName, lastName),
    },
  });
}

type MiniEntry = { firstName: string; lastName: string; carNumber: string };

function entry(e: MiniEntry, position: number): ParsedEntry {
  const seconds = 50 + position;
  return {
    classCode: "AS",
    position,
    trophy: false,
    carNumber: e.carNumber,
    altCarNumber: null,
    firstName: e.firstName,
    lastName: e.lastName,
    carDescription: null,
    hometown: null,
    bestSeconds: seconds,
    runs: [{ seconds, cones: 0, disposition: "CLEAN" }],
  };
}

function rmsoloEvent(title: string, entries: MiniEntry[]): ParsedRmsoloEvent {
  return { title, classCodes: ["AS"], entries: entries.map((e, i) => entry(e, i + 1)) };
}

/** One RMsolo event per call; distinct title + date + sha so nothing is treated as a re-ingest. */
function ingest(title: string, date: string, entries: MiniEntry[]) {
  return ingestRmsoloEvent({ parsed: rmsoloEvent(title, entries), sha256: `sha-${title}`, date }, prisma);
}

function driversNamed(firstName: string, lastName: string) {
  return prisma.driver.findMany({
    where: { nameOnlyHash: computeNameOnlyHash(firstName, lastName) },
    orderBy: { id: "asc" },
  });
}

describe("RMsolo driver identity (blank member number vs. an existing member row)", () => {
  it("reuses the member's existing Driver instead of minting a blank-member duplicate", async () => {
    const seeded = await seedMemberDriver("Jordan", "Blake", "SYN-101");

    const result = await ingest("Identity Merge 1", "2026-05-01", [
      { firstName: "Jordan", lastName: "Blake", carNumber: "301" },
    ]);
    expect(result.status).toBe("ingested");

    const jordans = await driversNamed("Jordan", "Blake");
    expect(jordans).toHaveLength(1);
    expect(jordans[0]!.id).toBe(seeded.id);
    expect(jordans[0]!.memberNum).toBe("SYN-101"); // the better-identified row wins, unchanged

    const entries = await prisma.entry.findMany({ where: { driverId: seeded.id } });
    expect(entries).toHaveLength(1);
  });

  it("keeps a later RMsolo event on that same Driver, so history does not fragment over a season", async () => {
    const seeded = await seedMemberDriver("Casey", "Rivera", "SYN-102");

    await ingest("Identity Merge 2a", "2026-05-02", [
      { firstName: "Casey", lastName: "Rivera", carNumber: "302" },
    ]);
    await ingest("Identity Merge 2b", "2026-06-02", [
      { firstName: "Casey", lastName: "Rivera", carNumber: "302" },
    ]);

    const caseys = await driversNamed("Casey", "Rivera");
    expect(caseys).toHaveLength(1);
    expect(caseys[0]!.id).toBe(seeded.id);

    const entries = await prisma.entry.findMany({ where: { driverId: seeded.id } });
    expect(entries).toHaveLength(2); // one per event, not one driver per event
  });

  it("refuses to guess when two members share a full name, creating a separate blank-member Driver", async () => {
    await seedMemberDriver("Taylor", "Nguyen", "SYN-201");
    await seedMemberDriver("Taylor", "Nguyen", "SYN-202");

    await ingest("Identity Ambiguity", "2026-05-03", [
      { firstName: "Taylor", lastName: "Nguyen", carNumber: "303" },
    ]);

    const taylors = await driversNamed("Taylor", "Nguyen");
    expect(taylors).toHaveLength(3);
    expect(taylors.filter((d) => d.memberNum == null)).toHaveLength(1);
  });

  it("still creates a blank-member Driver when no member shares the name", async () => {
    await ingest("Identity No Twin", "2026-05-04", [
      { firstName: "Robin", lastName: "Vance", carNumber: "304" },
    ]);

    const robins = await driversNamed("Robin", "Vance");
    expect(robins).toHaveLength(1);
    expect(robins[0]!.memberNum).toBeNull();
    expect(robins[0]!.identityHash).toBe(computeIdentityHash(null, "Robin", "Vance"));
  });
});
