import { describe, expect, it } from "vitest";
import { acquireIngestLock, ingestNowCapability } from "@/lib/rmsolo-run";

// Capability probe + per-league mutex only — the scrape loop itself
// (runRmsoloIngest) hits the live network and is intentionally NOT tested here.
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
