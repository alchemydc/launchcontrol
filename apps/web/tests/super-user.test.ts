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
});
