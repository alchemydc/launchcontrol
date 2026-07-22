import { afterEach, describe, expect, it } from "vitest";
import { getClubConfig, formatDriverName } from "@/lib/club-config";

const TOUCHED = [
  "SITE_TITLE", "SITE_DESCRIPTION", "FOOTER_TEXT", "LANDING_DESCRIPTION",
  "ACCESS_GATE", "NAME_DISPLAY", "MSR_ORG_ID", "MSR_RMR_ORG_ID", "MSR_CONSUMER_KEY",
] as const;

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
});

describe("getClubConfig", () => {
  it("defaults reproduce current PCA behavior exactly", () => {
    const c = getClubConfig();
    expect(c.siteTitle).toBe("Launch Control · PCA RMR");
    expect(c.siteDescription).toBe(
      "Rocky Mountain Region autocross results, calendar, and community media.",
    );
    expect(c.footerText).toBe(
      "Built for PCA Rocky Mountain Region · Autocross results from VisualAX",
    );
    expect(c.accessGate).toBe("required");
    expect(c.nameDisplay).toBe("initial");
  });

  it("reads overrides from env", () => {
    process.env.SITE_TITLE = "RM Solo Results";
    process.env.ACCESS_GATE = "optional";
    process.env.NAME_DISPLAY = "full";
    const c = getClubConfig();
    expect(c.siteTitle).toBe("RM Solo Results");
    expect(c.accessGate).toBe("optional");
    expect(c.nameDisplay).toBe("full");
  });

  it("throws on invalid ACCESS_GATE / NAME_DISPLAY values", () => {
    process.env.ACCESS_GATE = "sometimes";
    expect(() => getClubConfig()).toThrow(/ACCESS_GATE/);
    delete process.env.ACCESS_GATE;
    process.env.NAME_DISPLAY = "redacted";
    expect(() => getClubConfig()).toThrow(/NAME_DISPLAY/);
  });

  it("msrOrgId prefers MSR_ORG_ID, falls back to MSR_RMR_ORG_ID, else null", () => {
    expect(getClubConfig().msrOrgId).toBeNull();
    process.env.MSR_RMR_ORG_ID = "LEGACY";
    expect(getClubConfig().msrOrgId).toBe("LEGACY");
    process.env.MSR_ORG_ID = "NEW";
    expect(getClubConfig().msrOrgId).toBe("NEW");
  });

  it("loginEnabled iff MSR_CONSUMER_KEY set and gate is not none", () => {
    expect(getClubConfig().loginEnabled).toBe(false);
    process.env.MSR_CONSUMER_KEY = "k";
    expect(getClubConfig().loginEnabled).toBe(true);
    process.env.ACCESS_GATE = "none";
    expect(getClubConfig().loginEnabled).toBe(false);
  });
});

describe("formatDriverName", () => {
  it("initial mode renders First L.", () => {
    expect(formatDriverName({ firstName: "Ken", lastInitial: "P.", lastName: "Pike" }))
      .toBe("Ken P.");
  });

  it("full mode renders First Last when lastName present", () => {
    process.env.NAME_DISPLAY = "full";
    expect(formatDriverName({ firstName: "Ken", lastInitial: "P.", lastName: "Pike" }))
      .toBe("Ken Pike");
  });

  it("full mode falls back to lastInitial when lastName missing", () => {
    process.env.NAME_DISPLAY = "full";
    expect(formatDriverName({ firstName: "Ken", lastInitial: "P.", lastName: null }))
      .toBe("Ken P.");
  });
});

describe("season config (PAX section + planned events)", () => {
  afterEach(() => {
    delete process.env.SEASON_PAX_SECTION;
    delete process.env.PLANNED_SEASON_EVENTS;
  });

  it("seasonPaxSection defaults off and enables on '1' or 'true'", () => {
    expect(getClubConfig().seasonPaxSection).toBe(false);
    process.env.SEASON_PAX_SECTION = "1";
    expect(getClubConfig().seasonPaxSection).toBe(true);
    process.env.SEASON_PAX_SECTION = "true";
    expect(getClubConfig().seasonPaxSection).toBe(true);
    process.env.SEASON_PAX_SECTION = "0";
    expect(getClubConfig().seasonPaxSection).toBe(false);
  });

  it("plannedSeasonEvents defaults null and parses 'year:count' pairs", () => {
    expect(getClubConfig().plannedSeasonEvents).toBeNull();
    process.env.PLANNED_SEASON_EVENTS = "2026:10";
    expect(getClubConfig().plannedSeasonEvents).toEqual({ 2026: 10 });
    process.env.PLANNED_SEASON_EVENTS = "2026:10,2027:8";
    expect(getClubConfig().plannedSeasonEvents).toEqual({ 2026: 10, 2027: 8 });
  });

  it("throws on malformed PLANNED_SEASON_EVENTS", () => {
    process.env.PLANNED_SEASON_EVENTS = "ten";
    expect(() => getClubConfig()).toThrow(/PLANNED_SEASON_EVENTS/);
  });
});
