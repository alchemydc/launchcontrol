/**
 * ScoringPolicy v3 — the scoring knobs stored as JSON on a ScoringSystem
 * ("ruleset") row, read live through `Season.rulesetId` (Task R2 — seasons
 * no longer snapshot a policy of their own). This is the only shape in play
 * right now: no formula DSL, no per-field defaulting. Every seeded ruleset
 * row carries a complete, valid policy (see the league-foundation +
 * ruleset-centric migrations and `createLeague`'s default), so
 * `parseScoringPolicy` never needs to paper over a partial row — a malformed
 * or incomplete policy is a data bug and should throw, not silently coerce.
 *
 * v2 (Task R1) dropped v1's per-policy raw/pax class-ranking toggle: class
 * sections now always rank on the entry's applied-PAX-indexed best time
 * (see season-leaderboard.ts). For a class whose entries all share one PAX
 * factor this is a pure rescale of the raw best — identical order and
 * points to the old "raw" behavior — and for run-group classes whose
 * entries carry per-driver derived factors it's the official (indexed)
 * ordering the old "pax" setting existed to produce. Since there was never
 * a case where "raw" gave a *different, still-correct* ordering, the toggle
 * only ever hid a bug for run-group classes — so it was removed rather than
 * defaulted.
 *
 * v3 separates two concepts that the old `floor(N/2)+1` threshold coupled:
 * `dropCount` is a ruleset scoring parameter, while the minimum attendance
 * required for an official standing lives on Season. `dropTiming` retains
 * v2's fixed/proportional behavior but is named for what it actually controls.
 * Older payloads are rejected outright; migrations canonicalize stored rows
 * before this code deploys.
 */
export type ScoringPolicy = {
  v: 3;
  /** Number of lowest season scores discarded once the season is complete. */
  dropCount: number;
  /**
   * fixed: use the season-end counted target throughout the season (PCA —
   * mid-season, nothing drops until a driver has more scores than that target).
   * proportional: drops scale with completed events (RMsolo) — see
   * `countedEventTarget` in season-leaderboard.ts.
   */
  dropTiming: "fixed" | "proportional";
  /** Synthetic overall-PAX standings section, pinned first (season-leaderboard.ts PAX_SECTION_CODE). */
  paxSection: boolean;
  /** Milliseconds added per cone struck. PCA convention is 2000. */
  conePenaltyMs: number;
};

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  v: 3,
  dropCount: 2,
  dropTiming: "fixed",
  paxSection: false,
  conePenaltyMs: 2000,
};

function fail(field: string, expected: string, raw: unknown): never {
  throw new Error(`scoringPolicy.${field} must be ${expected} — got ${JSON.stringify(raw)}`);
}

/**
 * Strictly parse and validate a ScoringSystem row's `policy` JSON string.
 * Throws on invalid JSON, an unrecognized `v`, or any missing/malformed
 * field — naming the offending field in the error so a bad seed or a hand-
 * edited row fails loudly rather than silently scoring wrong.
 */
export function parseScoringPolicy(json: string): ScoringPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `scoringPolicy is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`scoringPolicy must be a JSON object — got ${JSON.stringify(raw)}`);
  }
  const obj = raw as Record<string, unknown>;

  if (obj.v !== 3) {
    fail("v", "3", obj.v);
  }
  if (
    typeof obj.dropCount !== "number" ||
    !Number.isInteger(obj.dropCount) ||
    obj.dropCount < 0
  ) {
    fail("dropCount", "a non-negative integer", obj.dropCount);
  }
  if (obj.dropTiming !== "fixed" && obj.dropTiming !== "proportional") {
    fail("dropTiming", '"fixed" or "proportional"', obj.dropTiming);
  }
  if (typeof obj.paxSection !== "boolean") {
    fail("paxSection", "a boolean", obj.paxSection);
  }
  if (typeof obj.conePenaltyMs !== "number" || !Number.isFinite(obj.conePenaltyMs) || obj.conePenaltyMs < 0) {
    fail("conePenaltyMs", "a non-negative number", obj.conePenaltyMs);
  }

  return {
    v: 3,
    dropCount: obj.dropCount,
    dropTiming: obj.dropTiming,
    paxSection: obj.paxSection,
    conePenaltyMs: obj.conePenaltyMs,
  };
}
