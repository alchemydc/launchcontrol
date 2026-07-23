/**
 * ScoringPolicy v1 — the scoring knobs stored as a JSON snapshot on a Season
 * row (copied from a ScoringSystem preset at adoption time, never a live
 * reference — see schema.prisma `Season.scoringPolicy`). This is the only
 * shape in play right now: no formula DSL, no per-field defaulting. Every
 * seeded Season row carries a complete, valid policy (see the
 * league-foundation migration and `ingest.ts`'s bare-Season default), so
 * `parseScoringPolicy` never needs to paper over a partial row — a malformed
 * or incomplete policy is a data bug and should throw, not silently coerce.
 */
export type ScoringPolicy = {
  v: 1;
  /**
   * fixed: count the best qualifying-threshold scores regardless of season
   * progress (PCA — mid-season, nothing drops).
   * proportional: drops scale with completed events (RMsolo) — see
   * `countedEventTarget` in season-leaderboard.ts.
   */
  drops: "fixed" | "proportional";
  /** Synthetic overall-PAX standings section, pinned first (season-leaderboard.ts PAX_SECTION_CODE). */
  paxSection: boolean;
  /** raw: class sections rank on best-corrected time. pax: rank on time × entry.paxClass.paxIndex. */
  classMetric: "raw" | "pax";
  /** Milliseconds added per cone struck. PCA convention is 2000. */
  conePenaltyMs: number;
};

function fail(field: string, expected: string, raw: unknown): never {
  throw new Error(`scoringPolicy.${field} must be ${expected} — got ${JSON.stringify(raw)}`);
}

/**
 * Strictly parse and validate a Season row's `scoringPolicy` JSON string.
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

  if (obj.v !== 1) {
    fail("v", "1", obj.v);
  }
  if (obj.drops !== "fixed" && obj.drops !== "proportional") {
    fail("drops", '"fixed" or "proportional"', obj.drops);
  }
  if (typeof obj.paxSection !== "boolean") {
    fail("paxSection", "a boolean", obj.paxSection);
  }
  if (obj.classMetric !== "raw" && obj.classMetric !== "pax") {
    fail("classMetric", '"raw" or "pax"', obj.classMetric);
  }
  if (typeof obj.conePenaltyMs !== "number" || !Number.isFinite(obj.conePenaltyMs) || obj.conePenaltyMs < 0) {
    fail("conePenaltyMs", "a non-negative number", obj.conePenaltyMs);
  }

  return {
    v: 1,
    drops: obj.drops,
    paxSection: obj.paxSection,
    classMetric: obj.classMetric,
    conePenaltyMs: obj.conePenaltyMs,
  };
}
