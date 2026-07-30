import { describe, expect, it } from "vitest";
import { parseScoringPolicy } from "@/lib/scoring-policy";

const PCA_POLICY_JSON =
  '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
  '"points":{"type":"ratio1000","basis":"class"}}';
const RMSOLO_POLICY_JSON =
  '{"v":4,"dropCount":4,"dropTiming":"proportional","paxSection":true,"conePenaltyMs":2000,' +
  '"points":{"type":"ratio1000","basis":"event"}}';
const POSITION_POLICY_JSON =
  '{"v":4,"dropCount":0,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
  '"points":{"type":"position","table":[20,15,12],"beyondTable":1,"basis":"class"}}';

describe("parseScoringPolicy", () => {
  it("parses the seeded PCA Classic policy", () => {
    expect(parseScoringPolicy(PCA_POLICY_JSON)).toEqual({
      v: 4,
      dropCount: 2,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
      points: { type: "ratio1000", basis: "class" },
    });
  });

  it("parses the RMsolo-shaped policy", () => {
    expect(parseScoringPolicy(RMSOLO_POLICY_JSON)).toEqual({
      v: 4,
      dropCount: 4,
      dropTiming: "proportional",
      paxSection: true,
      conePenaltyMs: 2000,
      points: { type: "ratio1000", basis: "event" },
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
        '{"v":4,"dropCount":-1,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects a fractional dropCount", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":1.5,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects a missing dropCount", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.dropCount/);
  });

  it("rejects an invalid dropTiming value", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"half","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.dropTiming/);
  });

  it("rejects a missing dropTiming field", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.dropTiming/);
  });

  it("rejects a non-boolean paxSection", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":"false","conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.paxSection/);
  });

  it("rejects a non-numeric conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":"2000",' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });

  it("rejects a negative conePenaltyMs", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":-1,' +
          '"points":{"type":"ratio1000","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.conePenaltyMs/);
  });

  it("parses a position-table policy", () => {
    expect(parseScoringPolicy(POSITION_POLICY_JSON)).toEqual({
      v: 4,
      dropCount: 0,
      dropTiming: "fixed",
      paxSection: false,
      conePenaltyMs: 2000,
      points: { type: "position", table: [20, 15, 12], beyondTable: 1, basis: "class" },
    });
  });

  it("rejects a v3 payload, naming the v field", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":3,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.v/);
  });

  it("rejects a missing points block", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000}',
      ),
    ).toThrow(/scoringPolicy\.points/);
  });

  it("rejects an unknown points type", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"elo","basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.points\.type/);
  });

  it("rejects an unknown points basis", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"ratio1000","basis":"paddock"}}',
      ),
    ).toThrow(/scoringPolicy\.points\.basis/);
  });

  it("rejects an empty position table", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"position","table":[],"beyondTable":1,"basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.points\.table/);
  });

  it("rejects a non-numeric position table entry, naming its index", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"position","table":[20,"15",12],"beyondTable":1,"basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.points\.table\[1\]/);
  });

  it("rejects a negative beyondTable", () => {
    expect(() =>
      parseScoringPolicy(
        '{"v":4,"dropCount":2,"dropTiming":"fixed","paxSection":false,"conePenaltyMs":2000,' +
          '"points":{"type":"position","table":[20,15],"beyondTable":-1,"basis":"class"}}',
      ),
    ).toThrow(/scoringPolicy\.points\.beyondTable/);
  });
});
