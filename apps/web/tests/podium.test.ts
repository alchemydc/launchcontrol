import { describe, expect, it } from "vitest";
import { ordinal } from "@/components/podium";

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [10, "10th"],
    // Teens always take "th" (11th/12th/13th, never 11st/12nd/13rd)
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [14, "14th"],
    [20, "20th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [100, "100th"],
    [101, "101st"],
    // Same teen rule applies past 100 (111th/112th/113th)
    [111, "111th"],
    [112, "112th"],
    [113, "113th"],
    [121, "121st"],
  ])("returns %s for %i", (input, expected) => {
    expect(ordinal(input)).toBe(expected);
  });
});
