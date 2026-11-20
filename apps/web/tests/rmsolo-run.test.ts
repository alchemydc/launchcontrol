import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { acquireIngestLock, ingestNowCapability, pdftotextCapability, rmsoloSourceSha256 } from "@/lib/rmsolo-run";

// Capability probe + per-league mutex only — the scrape loop itself
// (runRmsoloIngest) hits the live network and is intentionally NOT tested here.
describe("pdftotextCapability", () => {
  it("reports whether the Poppler system executable is available", () => {
    const cap = pdftotextCapability();
    if (cap.enabled) {
      expect(cap.reason).toBeUndefined();
    } else {
      expect(cap.reason).toMatch(/pdftotext/i);
      expect(cap.reason).toMatch(/poppler-utils/i);
    }
  });
});

describe("ingestNowCapability", () => {
  it("disabled without env flag", () => {
    delete process.env.INGEST_NOW_ENABLED;
    expect(ingestNowCapability().enabled).toBe(false);
  });

  it("with the flag set, shape depends only on pdftotext presence", () => {
    // Don't assume the CI/dev machine has poppler installed: assert the
    // contract both ways. Flag set + pdftotext resolvable → enabled; flag set
    // + pdftotext missing → disabled with a reason that names pdftotext.
    process.env.INGEST_NOW_ENABLED = "1";
    const cap = ingestNowCapability();
    if (cap.enabled) {
      expect(cap.reason).toBeUndefined();
    } else {
      expect(cap.reason).toMatch(/pdftotext/i);
    }
    delete process.env.INGEST_NOW_ENABLED;
  });
});

describe("ingest-now mutex", () => {
  it("second concurrent run for the same league is rejected", () => {
    const release = acquireIngestLock("rmsolo");
    expect(release).not.toBeNull();
    expect(acquireIngestLock("rmsolo")).toBeNull();
    expect(acquireIngestLock("other-league")).not.toBeNull();
    release!();
    expect(acquireIngestLock("rmsolo")).not.toBeNull();
  });
});

describe("rmsoloSourceSha256", () => {
  const full = Buffer.from("%PDF-full");
  const index = Buffer.from("%PDF-index");

  it("is the plain sha256 of the Full PDF when there is no Index PDF", () => {
    expect(rmsoloSourceSha256(full)).toBe(createHash("sha256").update(full).digest("hex"));
  });

  it("changes when an Index PDF is added, so a Full-only event re-ingests", () => {
    expect(rmsoloSourceSha256(full, index)).not.toBe(rmsoloSourceSha256(full));
  });

  it("is stable for the same pair and changes with the Index PDF", () => {
    expect(rmsoloSourceSha256(full, index)).toBe(rmsoloSourceSha256(full, index));
    expect(rmsoloSourceSha256(full, Buffer.from("%PDF-index-v2"))).not.toBe(rmsoloSourceSha256(full, index));
  });
});
