import { afterEach, describe, expect, it } from "vitest";
import { isAdmin } from "@/lib/admin";

describe("isAdmin()", () => {
  const original = process.env.ADMIN_MSR_UIDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_MSR_UIDS;
    } else {
      process.env.ADMIN_MSR_UIDS = original;
    }
  });

  it("returns false when msrUid is undefined", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(isAdmin(undefined)).toBe(false);
  });

  it("returns false when msrUid is null", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(isAdmin(null)).toBe(false);
  });

  it("returns false when msrUid is empty string", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(isAdmin("")).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is not set", () => {
    delete process.env.ADMIN_MSR_UIDS;
    expect(isAdmin("UID-001")).toBe(false);
  });

  it("returns false when ADMIN_MSR_UIDS is empty string", () => {
    process.env.ADMIN_MSR_UIDS = "";
    expect(isAdmin("UID-001")).toBe(false);
  });

  it("returns true for a single matching UID", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(isAdmin("UID-001")).toBe(true);
  });

  it("returns true when UID is in a comma-separated list", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002,UID-003";
    expect(isAdmin("UID-002")).toBe(true);
  });

  it("returns false when UID is not in the comma-separated list", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,UID-002";
    expect(isAdmin("UID-003")).toBe(false);
  });

  it("trims whitespace around UIDs", () => {
    process.env.ADMIN_MSR_UIDS = " UID-001 , UID-002 ";
    expect(isAdmin("UID-001")).toBe(true);
    expect(isAdmin("UID-002")).toBe(true);
  });

  it("is case-sensitive", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001";
    expect(isAdmin("uid-001")).toBe(false);
  });

  it("ignores empty entries from double commas", () => {
    process.env.ADMIN_MSR_UIDS = "UID-001,,UID-002";
    expect(isAdmin("")).toBe(false);
    expect(isAdmin("UID-002")).toBe(true);
  });
});
