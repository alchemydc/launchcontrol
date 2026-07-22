/**
 * Club configuration — every club-specific behavior is env-driven so one
 * codebase serves multiple club deployments. Defaults reproduce the original
 * PCA RMR deployment byte-for-byte (the upstream-compatibility contract).
 */

export type AccessGate = "required" | "optional" | "none";

export type ClubConfig = {
  siteTitle: string;
  siteDescription: string;
  footerText: string;
  landingDescription: string;
  /** required: session+org membership gates results (PCA). optional: public results, login offered. none: public, no login UI. */
  accessGate: AccessGate;
  /** MSR org UUID for membership display/gating. MSR_ORG_ID preferred; MSR_RMR_ORG_ID honored as legacy alias. */
  msrOrgId: string | null;
  /** Login UI renders only when MSR credentials exist and the gate allows sign-in. */
  loginEnabled: boolean;
  /** Enable overall-PAX standings views: the season leaderboard PAX section and the event-page PAX view (PAX_STANDINGS=1). */
  paxStandings: boolean;
  /** Per-year planned event counts ("2026:10,2027:8") overriding the built-in PCA map; null = use the built-in. */
  plannedSeasonEvents: Record<number, number> | null;
  /**
   * fixed (default): count the best qualifying-threshold scores regardless of
   * season progress (PCA behavior — mid-season, nothing drops).
   * proportional: drops scale with completed events — counted = completed −
   * floor(completed × seasonDrops / seasonSize) — so a half-run season carries
   * half its total drops (RMsolo: best 3 of 5 mid-season, best 6 of 10 final).
   */
  seasonDrops: "fixed" | "proportional";
};

function parsePlannedSeasonEvents(raw: string | undefined): Record<number, number> | null {
  if (raw == null || raw === "") return null;
  const out: Record<number, number> = {};
  for (const pair of raw.split(",")) {
    const m = pair.trim().match(/^(\d{4}):(\d{1,3})$/);
    if (!m) {
      throw new Error(
        `PLANNED_SEASON_EVENTS must be comma-separated "year:count" pairs (e.g. "2026:10") — got ${JSON.stringify(raw)}`,
      );
    }
    out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

function oneOf<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: T): T {
  if (raw == null || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${name} must be one of ${allowed.join(", ")} — got ${JSON.stringify(raw)}`);
}

export function getClubConfig(): ClubConfig {
  const accessGate = oneOf("ACCESS_GATE", process.env.ACCESS_GATE, ["required", "optional", "none"] as const, "required");
  return {
    siteTitle: process.env.SITE_TITLE || "Launch Control · PCA RMR",
    siteDescription:
      process.env.SITE_DESCRIPTION ||
      "Rocky Mountain Region autocross results, calendar, and community media.",
    footerText:
      process.env.FOOTER_TEXT ||
      "Built for PCA Rocky Mountain Region · Autocross results from VisualAX",
    landingDescription:
      process.env.LANDING_DESCRIPTION ||
      "Sign in with your MotorsportReg account to access Rocky Mountain Region autocross results, sortable event leaderboards, season standings, and driver profiles.",
    accessGate,
    msrOrgId: process.env.MSR_ORG_ID || process.env.MSR_RMR_ORG_ID || null,
    loginEnabled: Boolean(process.env.MSR_CONSUMER_KEY) && accessGate !== "none",
    paxStandings:
      process.env.PAX_STANDINGS === "1" || process.env.PAX_STANDINGS === "true",
    plannedSeasonEvents: parsePlannedSeasonEvents(process.env.PLANNED_SEASON_EVENTS),
    seasonDrops: oneOf("SEASON_DROPS", process.env.SEASON_DROPS, ["fixed", "proportional"] as const, "fixed"),
  };
}

/**
 * Single render point for driver names. PCA PII posture applies to every
 * source (project decision 2026-07-22): always "First L." — full surnames
 * are never stored. Anonymous entries render "Unknown #33" via their
 * car-number lastInitial.
 */
export function formatDriverName(d: { firstName: string; lastInitial: string }): string {
  return `${d.firstName} ${d.lastInitial}`;
}
