import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { isLeagueAdmin, isAnyLeagueAdmin } from "@/lib/admin";

// These tests exercise only the env-allowlist (superuser) half of the admin
// gates — the bootstrap path, which short-circuits before any DB access (see
// super-user.ts / admin.ts). Every case here passes a truthy msrUid with no
// env match (or no msrUid at all) so it never depends on real rows; a stub
// client returning no rows stands in for "not touching a real DB" on the
// cases that do fall through, keeping this suite a pure unit test. The
// membership-row half (env-only/row-only/both/neither/MEMBER-role, plus
// per-league isolation) is covered against a real migrated DB in
// tests/league-integrity.test.ts.
const NO_ROWS = {
  superUser: { findUnique: async () => null },
  leagueMembership: { findUnique: async () => null, findFirst: async () => null },
} as unknown as PrismaClient;

describe("isLeagueAdmin() env/superuser path", () => {
  const original = process.env.ADMIN_MSR_UIDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_MSR_UIDS;
    } else {
      process.env.ADMIN_MSR_UIDS = original;
    }
  });

  it("returns false when msrUid is undefined", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isLeagueAdmin(undefined, 1, NO_ROWS)).toBe(false);
  });

  it("returns false when msrUid is null", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isLeagueAdmin(null, 1, NO_ROWS)).toBe(false);
  });

  it("returns false when msrUid is empty string", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isLeagueAdmin("", 1, NO_ROWS)).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is not set", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    expect(await isLeagueAdmin("UID-001", 1, NO_ROWS)).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is empty string", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    expect(await isLeagueAdmin("UID-001", 1, NO_ROWS)).toBe(false);
  });

  it("env superuser short-circuits for any leagueId", async () => {
    process.env.ADMIN_MSR_UIDS = "SUPER";
    expect(await isLeagueAdmin("SUPER", 1, NO_ROWS)).toBe(true);
    expect(await isLeagueAdmin("SUPER", 999, NO_ROWS)).toBe(true);
  });

  it("returns true when UID is in a comma-separated list", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002,UID-003";
    expect(await isLeagueAdmin("UID-002", 1, NO_ROWS)).toBe(true);
  });

  it("returns false when UID is not in the comma-separated list", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002";
    expect(await isLeagueAdmin("UID-003", 1, NO_ROWS)).toBe(false);
  });

  it("trims whitespace around UIDs", async () => {
    process.env.ADMIN_MSR_UIDS = " UID-001 , UID-002 ";
    expect(await isLeagueAdmin("UID-001", 1, NO_ROWS)).toBe(true);
    expect(await isLeagueAdmin("UID-002", 1, NO_ROWS)).toBe(true);
  });

  it("is case-sensitive", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isLeagueAdmin("uid-001", 1, NO_ROWS)).toBe(false);
  });

  it("ignores empty entries from double commas", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,,UID-002";
    expect(await isLeagueAdmin("", 1, NO_ROWS)).toBe(false);
    expect(await isLeagueAdmin("UID-002", 1, NO_ROWS)).toBe(true);
  });
});

describe("isAnyLeagueAdmin() env/superuser path", () => {
  const original = process.env.ADMIN_MSR_UIDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_MSR_UIDS;
    } else {
      process.env.ADMIN_MSR_UIDS = original;
    }
  });

  it("returns false for a missing uid", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAnyLeagueAdmin(undefined, NO_ROWS)).toBe(false);
    expect(await isAnyLeagueAdmin(null, NO_ROWS)).toBe(false);
    expect(await isAnyLeagueAdmin("", NO_ROWS)).toBe(false);
  });

  it("env superuser short-circuits", async () => {
    process.env.ADMIN_MSR_UIDS = "SUPER";
    expect(await isAnyLeagueAdmin("SUPER", NO_ROWS)).toBe(true);
  });

  it("returns false for a non-superuser with no ADMIN row", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAnyLeagueAdmin("UID-999", NO_ROWS)).toBe(false);
  });
});
