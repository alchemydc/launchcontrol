import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { dbTarget, migrateDeploy } from "./helpers/db";
import {
  parseMembershipRole, setLeagueMembership, removeLeagueMembership, getMembershipRole,
} from "@/lib/membership";

const { path: DB_PATH, url: DB_URL } = dbTarget("membership");
let client: PrismaClient;
let leagueId: number;

beforeAll(async () => {
  rmSync(DB_PATH, { force: true });
  migrateDeploy(DB_URL);
  client = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });
  leagueId = (await client.league.findUniqueOrThrow({ where: { slug: "pca-rmr" } })).id;
});
afterAll(async () => { await client.$disconnect(); rmSync(DB_PATH, { force: true }); });

describe("parseMembershipRole", () => {
  it.each(["ADMIN", "MEMBER", "BLOCKED"])("accepts %s", (r) => {
    expect(parseMembershipRole(r)).toBe(r);
  });
  it.each(["admin", "", "OWNER", 3, null, undefined])("rejects %j", (v) => {
    expect(() => parseMembershipRole(v)).toThrow(/invalid membership role/i);
  });
});

describe("membership writes", () => {
  it("set creates then updates (upsert), get reads back, remove deletes", async () => {
    await setLeagueMembership(client, { leagueId, msrUid: "U1", role: "MEMBER" });
    expect(await getMembershipRole(client, leagueId, "U1")).toBe("MEMBER");
    await setLeagueMembership(client, { leagueId, msrUid: "U1", role: "BLOCKED" });
    expect(await getMembershipRole(client, leagueId, "U1")).toBe("BLOCKED");
    await removeLeagueMembership(client, { leagueId, msrUid: "U1" });
    expect(await getMembershipRole(client, leagueId, "U1")).toBeNull();
  });
  it("remove of a non-existent row is a no-op", async () => {
    await expect(removeLeagueMembership(client, { leagueId, msrUid: "GHOST" })).resolves.not.toThrow();
  });
});
