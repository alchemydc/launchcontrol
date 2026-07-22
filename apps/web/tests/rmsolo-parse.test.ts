// tests/rmsolo-parse.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRmsoloFullText, reconcileTimes } from "@/lib/rmsolo-parse";

const text = readFileSync(join(__dirname, "fixtures", "rmsolo-full.txt"), "utf8");
const parsed = parseRmsoloFullText(text);
const byName = (last: string) => parsed.entries.find((e) => e.lastName === last)!;

describe("parseRmsoloFullText", () => {
  it("extracts the event title", () => {
    expect(parsed.title).toBe("Summer 2026#1");
  });

  it("finds all classes, merging across page breaks", () => {
    expect(parsed.classCodes).toEqual(["AS", "BS", "XU"]);
    expect(parsed.entries.filter((e) => e.classCode === "BS")).toHaveLength(3);
  });

  it("parses position and trophy markers, including 'T 1' spacing", () => {
    expect(byName("Driver")).toMatchObject({ position: 1, trophy: true });
    expect(byName("Corner")).toMatchObject({ position: 3, trophy: false });
    expect(byName("Novice")).toBeDefined(); // two Novices; check first below
    const gray = parsed.entries.find((e) => e.firstName === "Gray")!;
    expect(gray).toMatchObject({ position: 1, trophy: true, carNumber: "118", altCarNumber: "18" });
  });

  it("parses identity zone: name / car / hometown split on 2+ spaces", () => {
    expect(byName("Driver")).toMatchObject({
      firstName: "Alex",
      lastName: "Driver",
      carDescription: "2003 Chevrolet Corvette Z06",
      hometown: "Faketown, CO",
      carNumber: "88",
      altCarNumber: null,
    });
  });

  it("collects runs across wrapped lines, skipping DNS slots", () => {
    // Alex Driver: 43.969, 42.908+1, 42.298, 42.492, 43.594+1, 42.833, DNS
    expect(byName("Driver").runs).toEqual([
      { seconds: 43.969, cones: 0, disposition: "CLEAN" },
      { seconds: 42.908, cones: 1, disposition: "CLEAN" },
      { seconds: 42.298, cones: 0, disposition: "CLEAN" },
      { seconds: 42.492, cones: 0, disposition: "CLEAN" },
      { seconds: 43.594, cones: 1, disposition: "CLEAN" },
      { seconds: 42.833, cones: 0, disposition: "CLEAN" },
    ]);
    // Bobby Racer has a 7th real run (42.550 on line 3)
    expect(byName("Racer").runs).toHaveLength(7);
    expect(byName("Racer").runs[6]).toEqual({ seconds: 42.55, cones: 0, disposition: "CLEAN" });
  });

  it("does not mistake the Best/gap column for a run", () => {
    // Bobby Racer line 2 ends with gap 0.018 — must not appear as a run
    expect(byName("Racer").runs.every((r) => r.seconds > 1)).toBe(true);
    expect(byName("Racer").bestSeconds).toBe(42.316);
  });

  it("handles concatenated DNF tokens (DNF45.993)", () => {
    const harper = parsed.entries.find((e) => e.firstName === "Harper")!;
    expect(harper.runs[5]).toEqual({ seconds: 45.993, cones: 0, disposition: "DNF" });
    expect(harper.bestSeconds).toBe(45.233);
  });

  it("handles cone counts > 1", () => {
    const evan = parsed.entries.find((e) => e.firstName === "Evan")!;
    expect(evan.runs[2]).toEqual({ seconds: 43.47, cones: 3, disposition: "CLEAN" });
  });

  it("handles all-DNS entries (zero runs, null best)", () => {
    const indy = parsed.entries.find((e) => e.firstName === "Indy")!;
    expect(indy.runs).toEqual([]);
    expect(indy.bestSeconds).toBeNull();
  });
});

describe("reconcileTimes", () => {
  it("confirms the fixture prints raw times (penalty added for scoring)", () => {
    expect(reconcileTimes(parsed).interpretation).toBe("raw");
  });

  it("throws when Best matches neither interpretation", () => {
    const broken = structuredClone(parsed);
    const e = broken.entries.find((x) => x.bestSeconds != null)!;
    e.bestSeconds = 1.234;
    expect(() => reconcileTimes(broken)).toThrow(/Best column/);
  });
});
