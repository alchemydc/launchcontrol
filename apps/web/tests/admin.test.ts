import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { isAdmin } from "@/lib/admin";

// These tests exercise only the env-allowlist half of isAdmin() — the
// superadmin bootstrap path, which short-circuits before any DB access (see
// admin.ts). Every case here passes a truthy msrUid with no env match (or no
// msrUid at all) so it never reaches the LeagueMembership lookup; a stub
// client with no League row stands in for "not touching a real DB" on the
// cases that do fall through, keeping this suite a pure unit test. The
// membership-row half (env-only/row-only/both/neither/MEMBER-role) is
// covered against a real migrated DB in tests/league-integrity.test.ts.
const NO_LEAGUE_CLIENT = {
  league: { findUnique: async () => null },
} as unknown as PrismaClient;

describe("isAdmin()", () => {
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
    expect(await isAdmin(undefined)).toBe(false);
  });

  it("returns false when msrUid is null", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAdmin(null)).toBe(false);
  });

  it("returns false when msrUid is empty string", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAdmin("")).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is not set", async () => {
    delete process.env.ADMIN_MSR_UIDS;
    expect(await isAdmin("UID-001", NO_LEAGUE_CLIENT)).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is empty string", async () => {
    process.env.ADMIN_MSR_UIDS = "";
    expect(await isAdmin("UID-001", NO_LEAGUE_CLIENT)).toBe(false);
  });

  it("returns true for a single matching UID", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAdmin("UID-001")).toBe(true);
  });

  it("returns true when UID is in a comma-separated list", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002,UID-003";
    expect(await isAdmin("UID-002")).toBe(true);
  });

  it("returns false when UID is not in the comma-separated list", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002";
    expect(await isAdmin("UID-003", NO_LEAGUE_CLIENT)).toBe(false);
  });

  it("trims whitespace around UIDs", async () => {
    process.env.ADMIN_MSR_UIDS = " UID-001 , UID-002 ";
    expect(await isAdmin("UID-001")).toBe(true);
    expect(await isAdmin("UID-002")).toBe(true);
  });

  it("is case-sensitive", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(await isAdmin("uid-001", NO_LEAGUE_CLIENT)).toBe(false);
  });

  it("ignores empty entries from double commas", async () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,,UID-002";
    expect(await isAdmin("", NO_LEAGUE_CLIENT)).toBe(false);
    expect(await isAdmin("UID-002")).toBe(true);
  });
});
