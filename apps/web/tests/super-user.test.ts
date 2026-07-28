import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { dbTarget, migrateDeploy } from "./helpers/db";
import { isSuperUser, setSuperUser } from "@/lib/super-user";

const ORIG_ENV = process.env.ADMIN_MSR_UIDS;
const { path: DB_PATH, url: DB_URL } = dbTarget("super-user");
let client: PrismaClient;

beforeAll(() => {
  rmSync(DB_PATH, { force: true });
  migrateDeploy(DB_URL);
  client = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });
});
afterAll(async () => { await client.$disconnect(); rmSync(DB_PATH, { force: true }); });
afterEach(() => { process.env.ADMIN_MSR_UIDS = ORIG_ENV; });

describe("isSuperUser", () => {
  it("false for missing uid", async () => {
    expect(await isSuperUser(undefined, client)).toBe(false);
    expect(await isSuperUser(null, client)).toBe(false);
  });
  it("true for env-allowlisted uid without any row", async () => {
    process.env.ADMIN_MSR_UIDS = "AAA, BBB";
    expect(await isSuperUser("BBB", client)).toBe(true);
  });
  it("true for a SuperUser row, false otherwise", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await client.superUser.create({ data: { msrUid: "ROW-1" } });
    expect(await isSuperUser("ROW-1", client)).toBe(true);
    expect(await isSuperUser("NOBODY", client)).toBe(false);
  });
});

describe("setSuperUser", () => {
  it("grants and revokes a row-backed superuser", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await setSuperUser(client, "GRANT-1", true);
    expect(await isSuperUser("GRANT-1", client)).toBe(true);
    await setSuperUser(client, "GRANT-1", false);
    expect(await isSuperUser("GRANT-1", client)).toBe(false);
  });
  it("grant is idempotent", async () => {
    await setSuperUser(client, "TWICE", true);
    await expect(setSuperUser(client, "TWICE", true)).resolves.not.toThrow();
  });
  it("refuses to revoke an env-bootstrap uid", async () => {
    process.env.ADMIN_MSR_UIDS = "ENVY";
    await expect(setSuperUser(client, "ENVY", false)).rejects.toThrow(/env/i);
  });
  it("refuses to revoke the last superuser row when no env bootstrap is configured", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await client.superUser.deleteMany({});
    await setSuperUser(client, "LAST-1", true);
    await expect(setSuperUser(client, "LAST-1", false)).rejects.toThrow(/last superuser/i);
    expect(await isSuperUser("LAST-1", client)).toBe(true);
  });
  it("allows revoking the last row when an env bootstrap uid exists", async () => {
    process.env.ADMIN_MSR_UIDS = "ENVY";
    await client.superUser.deleteMany({});
    await setSuperUser(client, "LAST-2", true);
    await setSuperUser(client, "LAST-2", false);
    expect(await isSuperUser("LAST-2", client)).toBe(false);
  });
  it("revoking a uid with no row is a no-op even when rows are empty", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await client.superUser.deleteMany({});
    await expect(setSuperUser(client, "GHOST", false)).resolves.not.toThrow();
  });
});

// PR #99 review: the others-count and the delete must share one transaction
// (two concurrent cross-revocations could otherwise both observe a survivor
// and both delete). setSuperUser opens its own transaction on a full client
// and runs inline on a transaction handle — this pins the handle path, which
// the superusers admin route now uses to make mutation + audit atomic.
describe("setSuperUser inside a caller-owned transaction", () => {
  it("revokes correctly when handed a transaction client", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await client.superUser.deleteMany({});
    await setSuperUser(client, "TX-A", true);
    await setSuperUser(client, "TX-B", true);
    await client.$transaction(async (tx) => {
      await setSuperUser(tx, "TX-B", false);
    });
    expect(await isSuperUser("TX-A", client)).toBe(true);
    expect(await isSuperUser("TX-B", client)).toBe(false);
  });

  it("still refuses to orphan the last superuser from inside a transaction", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    await client.superUser.deleteMany({});
    await setSuperUser(client, "TX-LAST", true);
    await expect(
      client.$transaction(async (tx) => {
        await setSuperUser(tx, "TX-LAST", false);
      }),
    ).rejects.toThrow(/last superuser/i);
    expect(await isSuperUser("TX-LAST", client)).toBe(true);
  });
});
