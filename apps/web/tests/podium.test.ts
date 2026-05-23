import { describe, expect, it } from "vitest";
import { ordinal } from "@/components/podium";

describe("ordinal", () => {
  it.each([
    ["1st", 1],
    ["2nd", 2],
    ["3rd", 3],
    ["4th", 4],
    ["10th", 10],
    // Teens always take "th" (11th/12th/13th, never 11st/12nd/13rd)
    ["11th", 11],
    ["12th", 12],
    ["13th", 13],
    ["14th", 14],
    ["20th", 20],
    ["21st", 21],
    ["22nd", 22],
    ["23rd", 23],
    ["100th", 100],
    ["101st", 101],
    // Same teen rule applies past 100 (111th/112th/113th)
    ["111th", 111],
    ["112th", 112],
    ["113th", 113],
    ["121st", 121],
  ])("returns %s for %d", (expected, input) => {
    expect(ordinal(input)).toBe(expected);
  });
});
