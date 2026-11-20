import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexClassKey, parseRmsoloIndexText } from "@/lib/rmsolo-index-pdf";

// Synthetic names only (see AGENTS.md PII rule); the layout mirrors a real
// 2024 RMsolo Index PDF run through `pdftotext -layout`.
const text = readFileSync(join(__dirname, "fixtures", "rmsolo-index.txt"), "utf8");

describe("parseRmsoloIndexText", () => {
  const rows = parseRmsoloIndexText(text);

  it("reads every real driver row and skips garbled ones", () => {
    expect(rows.map((r) => r.carNumber)).toEqual(["66", "113", "82", "99", "36", "2", "53", "19"]);
  });

  it("splits a run-group class into group and base class, keeping the printed factor", () => {
    const row = rows.find((r) => r.carNumber === "82")!;
    expect(row).toMatchObject({ name: "riley placeholder", classCode: "X/SST", group: "X", baseClass: "SST", factor: 0.836 });
  });

  it("leaves group null for a plain class", () => {
    expect(rows.find((r) => r.carNumber === "99")).toMatchObject({ group: null, baseClass: "SST" });
  });

  it("uses the part after the last slash as the base class", () => {
    expect(rows.find((r) => r.carNumber === "53")).toMatchObject({ group: "PS-CAM", baseClass: "CAMC", name: "quinn de la rowe" });
  });

  it("keeps a nameless row with an empty name", () => {
    expect(rows.find((r) => r.carNumber === "2")).toMatchObject({ name: "", baseClass: "STX", factor: 0.819 });
  });

  it("reads a driver with no time, whose class still matters for display", () => {
    expect(rows.find((r) => r.carNumber === "19")).toMatchObject({ name: "sky notime", classCode: "N/CAMT", baseClass: "CAMT", factor: 0.82 });
  });

  it("parses the older layouts (2017 marker column, Pronto Nbr column)", () => {
    const older = [
      "        Pos Name                   Class      Number                  Total Time   Index   Indexed Time PaxScore",
      "   R      3 Pat Oldformat          HS         17                          60.465   0.786          47.525    986",
      " Pos Nbr Name                           Class      Num       Time        Pax     Pax Time   From Prev From Top PaxScore",
      "   2   88    Sam Pronto                  X          88       31.845      0.824    26.240      -0.121     -0.121         995",
      "     Pos Name                         Class     Number      Total Time   Index Index Time From Previous        From Top PaxScore",
      "       4 Lee Middle                    X/SS         1          35.226     0.823   28.991      -0.009             -0.387    987",
    ].join("\n");
    expect(parseRmsoloIndexText(older)).toEqual([
      { name: "pat oldformat", carNumber: "17", classCode: "HS", group: null, baseClass: "HS", factor: 0.786 },
      { name: "sam pronto", carNumber: "88", classCode: "X", group: null, baseClass: "X", factor: 0.824 },
      { name: "lee middle", carNumber: "1", classCode: "X/SS", group: "X", baseClass: "SS", factor: 0.823 },
    ]);
  });
});

describe("indexClassKey", () => {
  it("matches a Full-PDF entry's split name and car number to the Index row", () => {
    expect(indexClassKey("Riley", "Placeholder", "82")).toBe(indexClassKey("riley  placeholder", "", "82"));
  });
});
