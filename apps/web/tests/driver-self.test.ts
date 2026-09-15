import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { dbTarget, migrateDeploy } from "./helpers/db";
import { computeNameOnlyHash } from "@/lib/pii";
import { claimSelfDriver, resolveSelfDriver } from "@/lib/driver-self";

const { path: DB_PATH, url: DB_URL } = dbTarget("driver-self");
let client: PrismaClient;

const HASH = computeNameOnlyHash("Alex", "Ada");

/** Minimal Driver row — identityHash is the only other required unique field. */
async function makeDriver(opts: {
  firstName?: string;
  lastInitial?: string;
  identityHash: string;
  nameOnlyHash?: string | null;
  msrUid?: string | null;
  memberNum?: string | null;
}) {
  return client.driver.create({
    data: {
      firstName: opts.firstName ?? "Alex",
      lastInitial: opts.lastInitial ?? "A.",
      identityHash: opts.identityHash,
      nameOnlyHash: opts.nameOnlyHash ?? null,
      msrUid: opts.msrUid ?? null,
      memberNum: opts.memberNum ?? null,
    },
  });
}

beforeAll(async () => {
  rmSync(DB_PATH, { force: true });
  migrateDeploy(DB_URL);
  client = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });
});
afterAll(async () => {
  await client.$disconnect();
  rmSync(DB_PATH, { force: true });
});
beforeEach(async () => {
  await client.driver.deleteMany({});
});

describe("resolveSelfDriver", () => {
  it("returns unmatched when the session has no msrUid", async () => {
    expect(await resolveSelfDriver({ nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });

  it("prefers an explicit Driver.msrUid link over the name hash", async () => {
    // The linked row carries a DIFFERENT name hash, so a hash-only resolver
    // would pick the other row — this asserts msrUid wins.
    const linked = await makeDriver({
      firstName: "Alexandra",
      identityHash: "id-linked",
      nameOnlyHash: computeNameOnlyHash("Alexandra", "Ada"),
      msrUid: "U1",
    });
    await makeDriver({ identityHash: "id-hash", nameOnlyHash: HASH });

    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "linked",
      driverId: linked.id,
      firstName: "Alexandra",
      lastInitial: "A.",
    });
  });

  it("matches on nameOnlyHash when exactly one driver carries it", async () => {
    const d = await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "linked",
      driverId: d.id,
      firstName: "Alex",
      lastInitial: "A.",
    });
  });

  it("returns unmatched when two drivers share the name hash", async () => {
    await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH });
    await makeDriver({ identityHash: "id-2", nameOnlyHash: HASH });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });

  it("returns unmatched when no driver carries the name hash", async () => {
    await makeDriver({ identityHash: "id-1", nameOnlyHash: computeNameOnlyHash("Bo", "Bea") });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });

  it("does not return a row already claimed by a different user", async () => {
    // Two humans share a full name; the other one logged in first. Returning
    // their row would show this viewer someone else's results.
    await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH, msrUid: "U2" });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });

  it("stays ambiguous when a claimed and an unclaimed row share the hash", async () => {
    // Ambiguity is a property of the data, not of who claimed what: filtering
    // claimed rows out would turn a genuine 2 into a false "exactly one".
    await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH, msrUid: "U2" });
    await makeDriver({ identityHash: "id-2", nameOnlyHash: HASH });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });

  it("returns unlinkable for a session minted before nameOnlyHash shipped", async () => {
    await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH });
    expect(await resolveSelfDriver({ msrUid: "U1" }, client)).toEqual({
      status: "unlinkable",
    });
  });

  it("does not match a legacy driver whose nameOnlyHash is null", async () => {
    await makeDriver({ identityHash: "id-1", nameOnlyHash: null });
    expect(await resolveSelfDriver({ msrUid: "U1", nameOnlyHash: HASH }, client)).toEqual({
      status: "unmatched",
    });
  });
});

describe("claimSelfDriver", () => {
  it("writes msrUid onto the single hash match", async () => {
    const d = await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH });
    await claimSelfDriver("U1", HASH, client);
    expect((await client.driver.findUniqueOrThrow({ where: { id: d.id } })).msrUid).toBe("U1");
  });

  it("leaves both rows alone when the hash is ambiguous", async () => {
    await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH });
    await makeDriver({ identityHash: "id-2", nameOnlyHash: HASH });
    await claimSelfDriver("U1", HASH, client);
    expect(await client.driver.count({ where: { msrUid: { not: null } } })).toBe(0);
  });

  it("does not steal a row already claimed by a different user", async () => {
    const d = await makeDriver({ identityHash: "id-1", nameOnlyHash: HASH, msrUid: "OTHER" });
    await claimSelfDriver("U1", HASH, client);
    expect((await client.driver.findUniqueOrThrow({ where: { id: d.id } })).msrUid).toBe("OTHER");
  });

  it("does not claim the unclaimed row when another same-name row is claimed", async () => {
    await makeDriver({ identityHash: "id-a", nameOnlyHash: HASH, msrUid: "U2" });
    const b = await makeDriver({ identityHash: "id-b", nameOnlyHash: HASH });
    await claimSelfDriver("U1", HASH, client);
    expect((await client.driver.findUniqueOrThrow({ where: { id: b.id } })).msrUid).toBeNull();
  });

  it("is a no-op when this user is already linked to another row", async () => {
    const linked = await makeDriver({
      identityHash: "id-linked",
      nameOnlyHash: computeNameOnlyHash("Alexandra", "Ada"),
      msrUid: "U1",
    });
    const other = await makeDriver({ identityHash: "id-hash", nameOnlyHash: HASH });

    await claimSelfDriver("U1", HASH, client);

    expect((await client.driver.findUniqueOrThrow({ where: { id: linked.id } })).msrUid).toBe("U1");
    expect((await client.driver.findUniqueOrThrow({ where: { id: other.id } })).msrUid).toBeNull();
  });

  it("is a no-op, and does not throw, when nothing carries the hash", async () => {
    await expect(claimSelfDriver("U1", HASH, client)).resolves.not.toThrow();
    expect(await client.driver.count({ where: { msrUid: { not: null } } })).toBe(0);
  });
});
