import { describe, expect, it } from "vitest";
import { parseScoringPolicy } from "@/lib/scoring-policy";

const PCA_POLICY_JSON =
  '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}';
const RMSOLO_POLICY_JSON =
  '{"v":3,"dropCount":4,"dropTiming":"proportional","paxSection":true,"conePenaltyMs":2000}';

describe("parseScoringPolicy", () => {
  it("parses the seeded PCA Classic policy", () => {
    expect(parseScoringPolicy(PCA_POLICY_JSON)).toEqual({
      v: 3,
      dropCount: 2,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
    });
  });

  it("parses the RMsolo-shaped policy", () => {
    expect(parseScoringPolicy(RMSOLO_POLICY_JSON)).toEqual({
      v: 3,
      dropCount: 4,
      dropTiming: "proportional",
      paxSection: true,
      conePenaltyMs: 2000,
    });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseScoringPolicy("{not json")).toThrow(/not valid JSON/);
  });

  it("rejects a non-object JSON value", () => {
    expect(() => parseScoringPolicy("[1,2,3]")).toThrow(/must be a JSON object/);
    expect(() => parseScoringPolicy('"raw"')).toThrow(/must be a JSON object/);
    expect(() => parseScoringPolicy("null")).toThrow(/must be a JSON object/);
    expect(() => parseScoringPolicy("42")).toThrow(/must be a JSON object/);
  });

  // Migrations canonicalize every stored row before v3 app code deploys, so
  // older policy versions fail loudly instead of being interpreted with
  // hidden defaults.
  // The error names the offending field ("v") so a not-yet-migrated row
  // fails loudly rather than silently scoring wrong.
  it("rejects a v1 payload, naming the v field", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects a v2 payload, naming the v field", () => {
    expect(() =>
      parseScoringPolicy('{"v":2,"drops":"fixed","paxSection":false,"conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects a missing v", () => {
    expect(() =>
      parseScoringPolicy(
        '{"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects a negative dropCount", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":-1,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects a fractional dropCount", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":1.5,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects a missing dropCount", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects an invalid dropTiming value", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":2,"dropTiming":"half","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.dropTiming/);
  });

  it("rejects a missing dropTiming field", () => {
    expect(() =>
      parseScoringPolicy('{"v":3,"dropCount":2,"paxSection":false,"conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.dropTiming/);
  });

  it("rejects a non-boolean paxSection", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":"false","conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.paxSection/);
  });

  it("rejects a non-numeric conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":"2000"}',
      ),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });

  it("rejects a negative conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":-1}',
      ),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });
});
