import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAxdbBuffer } from "@/lib/axdb-validate";

const FIXTURE = resolve(__dirname, "fixtures", "synthetic.axdb");

describe("validateAxdbBuffer()", () => {
  it("accepts the synthetic fixture as valid", () => {
    const buf = readFileSync(FIXTURE);
    const result = validateAxdbBuffer(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tempPath).toMatch(/axdb-.*\.axdb$/);
    }
  });

  it("rejects a buffer with wrong magic header", () => {
    const buf = Buffer.from("This is not a SQLite file at all, just text content here.");
    const result = validateAxdbBuffer(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not a SQLite database");
    }
  });

  it("rejects a buffer that is too short to contain the magic header", () => {
    const buf = Buffer.from("SQLite");
    const result = validateAxdbBuffer(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not a SQLite database");
    }
  });

  it("rejects a truncated SQLite file that fails integrity check", () => {
    const original = readFileSync(FIXTURE);
    // Keep the magic header but truncate the rest — SQLite will refuse to open it
    const truncated = original.subarray(0, 32);
    const result = validateAxdbBuffer(truncated);
    expect(result.ok).toBe(false);
  });

});
