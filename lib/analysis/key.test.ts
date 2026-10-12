import { describe, expect, it } from "vitest";
import { keyCompatibility, toCamelot } from "./key";

describe("toCamelot", () => {
  it.each([
    ["Am", "8A"],
    ["A minor", "8A"],
    ["C", "8B"],
    ["C major", "8B"],
    ["G", "9B"],
    ["Em", "9A"],
    ["F#m", "11A"],
    ["Gbm", "11A"],
    ["Dbm", "12A"],
    ["C#m", "12A"],
    ["Bbm", "3A"],
    ["Ab", "4B"],
    ["Eb major", "5B"],
    ["F", "7B"],
    ["B", "1B"],
    ["8A", "8A"],
    ["12b", "12B"],
    ["1m", "8A"], // Open Key 1m = A minor
    ["1d", "8B"], // Open Key 1d = C major
  ])("%s → %s", (input, expected) => {
    expect(toCamelot(input)).toBe(expected);
  });

  it("returns null for unreadable tags", () => {
    expect(toCamelot("")).toBeNull();
    expect(toCamelot(null)).toBeNull();
    expect(toCamelot("unknown")).toBeNull();
    expect(toCamelot("13A")).toBeNull();
  });
});

describe("keyCompatibility", () => {
  it("scores the Camelot wheel", () => {
    expect(keyCompatibility("8A", "8A")).toBe(1);
    expect(keyCompatibility("8A", "9A")).toBe(0.9);
    expect(keyCompatibility("12A", "1A")).toBe(0.9); // wraps around
    expect(keyCompatibility("8A", "8B")).toBe(0.8);
    expect(keyCompatibility("8A", "10A")).toBe(0.5);
    expect(keyCompatibility("8A", "3B")).toBe(0.1);
    expect(keyCompatibility(null, "3B")).toBe(0.5);
  });
});
