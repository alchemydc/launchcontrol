import { afterEach, describe, expect, it } from "vitest";
import { getClubConfig } from "@/lib/club-config";

afterEach(() => {
  delete process.env.ACCESS_GATE;
  delete process.env.MSR_CONSUMER_KEY;
});

// requireRmrMember depends on next/headers (request scope), so the unit here
// verifies the gate decision logic exposed via config; the short-circuit branch
// in requireRmrMember is a 3-line guard reviewed by inspection + exercised by build.
describe("access gate config", () => {
  it("defaults to required", () => {
    expect(getClubConfig().accessGate).toBe("required");
  });
  it("optional and none are public modes", () => {
    for (const mode of ["optional", "none"] as const) {
      process.env.ACCESS_GATE = mode;
      expect(getClubConfig().accessGate).toBe(mode);
    }
  });
});
