/**
 * ScoringPolicy v4 — the scoring knobs stored as JSON on a ScoringSystem
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
 *
 * v4 makes the per-event points formula policy data rather than a hardcoded
 * per-class 1000 ratio. `points` is a discriminated union: `ratio1000` with
 * basis class (PCA — every class winner scores 1000) or event (RMsolo — one
 * PAX-relative score per driver per event, reused across sections), and
 * `position`, an ordered finish-position table. Older payloads are rejected
 * outright; the scoring_policy_v4 migration canonicalizes stored rows before
 * this code deploys.
 */
export type PointsBasis = "class" | "event";

/**
 * How one scoring group's points are computed. `basis` selects the population
 * a driver is scored against:
 *   class — the drivers in that class section (PCA: every class winner scores
 *           the maximum).
 *   event — every driver at the event, ranked on indexed time, so each driver
 *           earns exactly ONE score per event that is reused in their class
 *           section and in the synthetic PAX section (RMsolo's published rule:
 *           1000 × event fastest indexed time / your indexed time).
 */
export type PointsSystem =
  | { type: "ratio1000"; basis: PointsBasis }
  | { type: "position"; table: number[]; beyondTable: number; basis: PointsBasis };

export type ScoringPolicy = {
  v: 4;
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
  /** Per-event points system (v4). No default — a missing block is a data bug. */
  points: PointsSystem;
};

export const DEFAULT_POINTS_SYSTEM: PointsSystem = { type: "ratio1000", basis: "class" };

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  v: 4,
  dropCount: 2,
  dropTiming: "fixed",
  paxSection: false,
  conePenaltyMs: 2000,
  points: DEFAULT_POINTS_SYSTEM,
};

function fail(field: string, expected: string, raw: unknown): never {
  throw new Error(`scoringPolicy.${field} must be ${expected} — got ${JSON.stringify(raw)}`);
}

function parsePoints(raw: unknown): PointsSystem {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("points", "a JSON object", raw);
  }
  const obj = raw as Record<string, unknown>;

  if (obj.basis !== "class" && obj.basis !== "event") {
    fail("points.basis", '"class" or "event"', obj.basis);
  }

  if (obj.type === "ratio1000") {
    return { type: "ratio1000", basis: obj.basis };
  }

  if (obj.type === "position") {
    if (!Array.isArray(obj.table) || obj.table.length === 0) {
      fail("points.table", "a non-empty array", obj.table);
    }
    const table: unknown[] = obj.table;
    table.forEach((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        fail(`points.table[${index}]`, "a non-negative finite number", value);
      }
    });
    if (
      typeof obj.beyondTable !== "number" ||
      !Number.isFinite(obj.beyondTable) ||
      obj.beyondTable < 0
    ) {
      fail("points.beyondTable", "a non-negative finite number", obj.beyondTable);
    }
    return {
      type: "position",
      table: table as number[],
      beyondTable: obj.beyondTable,
      basis: obj.basis,
    };
  }

  return fail("points.type", '"ratio1000" or "position"', obj.type);
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

  if (obj.v !== 4) {
    fail("v", "4", obj.v);
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
    v: 4,
    dropCount: obj.dropCount,
    dropTiming: obj.dropTiming,
    paxSection: obj.paxSection,
    conePenaltyMs: obj.conePenaltyMs,
    points: parsePoints(obj.points),
  };
}
