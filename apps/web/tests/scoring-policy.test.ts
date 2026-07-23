import { describe, expect, it } from "vitest";
import { parseScoringPolicy } from "@/lib/scoring-policy";

const PCA_POLICY_JSON =
  '{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}';
const RMSOLO_POLICY_JSON =
  '{"v":1,"drops":"proportional","paxSection":true,"classMetric":"pax","conePenaltyMs":2000}';

describe("parseScoringPolicy", () => {
  it("parses the seeded PCA Classic policy", () => {
    expect(parseScoringPolicy(PCA_POLICY_JSON)).toEqual({
      v: 1,
      drops: "fixed",
      paxSection: false,
      classMetric: "raw",
      conePenaltyMs: 2000,
    });
  });

  it("parses the RMsolo-shaped policy", () => {
    expect(parseScoringPolicy(RMSOLO_POLICY_JSON)).toEqual({
      v: 1,
      drops: "proportional",
      paxSection: true,
      classMetric: "pax",
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

  it("rejects an unrecognized v", () => {
    expect(() =>
      parseScoringPolicy('{"v":2,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects a missing v", () => {
    expect(() =>
      parseScoringPolicy('{"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects an invalid drops value", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"half","paxSection":false,"classMetric":"raw","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.drops/);
  });

  it("rejects a missing drops field", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"paxSection":false,"classMetric":"raw","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.drops/);
  });

  it("rejects a non-boolean paxSection", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"fixed","paxSection":"false","classMetric":"raw","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.paxSection/);
  });

  it("rejects an invalid classMetric value", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"fixed","paxSection":false,"classMetric":"weighted","conePenaltyMs":2000}'),
    ).toThrow(/scoringPolicy\.classMetric/);
  });

  it("rejects a non-numeric conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":"2000"}'),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });

  it("rejects a negative conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy('{"v":1,"drops":"fixed","paxSection":false,"classMetric":"raw","conePenaltyMs":-1}'),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });
});
