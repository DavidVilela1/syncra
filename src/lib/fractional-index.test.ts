import { describe, expect, it } from "vitest";
import {
  FractionalIndexError,
  compareOrderKeys,
  generateKeyBetween,
  generateNKeysBetween,
  isValidOrderKey,
} from "./fractional-index";

describe("generateKeyBetween", () => {
  it.each([
    [null, null, "a0"],
    [null, "a0", "Zz"],
    ["a0", null, "a1"],
    ["a0", "a1", "a0V"],
    ["a1", "a2", "a1V"],
    ["az", null, "b00"],
    ["Zz", "a0", "ZzV"],
    ["a0V", "a1", "a0l"],
    [null, "A000000000000000000000000001", "A000000000000000000000000000V"],
    [null, "A00000000000000000000000001", "A00000000000000000000000000V"],
  ])("between(%s, %s) = %s", (a, b, expected) => {
    expect(generateKeyBetween(a, b)).toBe(expected);
  });

  it("rejects inverted or invalid bounds", () => {
    expect(() => generateKeyBetween("a1", "a0")).toThrow(FractionalIndexError);
    expect(() => generateKeyBetween("a0", "a0")).toThrow(FractionalIndexError);
    expect(() => generateKeyBetween("a00", null)).toThrow(FractionalIndexError); // trailing zero
    expect(() => generateKeyBetween("!", null)).toThrow(FractionalIndexError);
  });

  it("keeps appends short (logarithmic growth)", () => {
    let key: string | null = null;
    for (let i = 0; i < 10_000; i++) key = generateKeyBetween(key, null);
    expect(key!.length).toBeLessThanOrEqual(4);
  });

  it("survives a randomized drag-and-drop fuzz without ever breaking order", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const list: string[] = generateNKeysBetween(null, null, 20);
    for (let i = 0; i < 5_000; i++) {
      // Remove a random item and re-insert it at a random index — exactly a drag.
      list.splice(Math.floor(rand() * list.length), 1);
      const at = Math.floor(rand() * (list.length + 1));
      const key = generateKeyBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, key);

      for (let j = 1; j < list.length; j++) {
        expect(compareOrderKeys(list[j - 1]!, list[j]!)).toBe(-1);
      }
    }
    expect(list.every(isValidOrderKey)).toBe(true);
  });

  it("stays ordered under adversarial same-gap inserts", () => {
    let lo = "a0";
    const hi = "a1";
    for (let i = 0; i < 200; i++) {
      const k = generateKeyBetween(lo, hi);
      expect(lo < k && k < hi).toBe(true);
      lo = k;
    }
  });
});

describe("generateNKeysBetween", () => {
  it("produces n strictly increasing keys inside the bounds", () => {
    for (const [a, b] of [[null, null], ["a0", null], [null, "a0"], ["a0", "a5"]] as const) {
      const keys = generateNKeysBetween(a, b, 50);
      expect(keys).toHaveLength(50);
      const sorted = [...keys].sort(compareOrderKeys);
      expect(keys).toEqual(sorted);
      expect(new Set(keys).size).toBe(50);
      if (a) expect(keys[0]! > a).toBe(true);
      if (b) expect(keys.at(-1)! < b).toBe(true);
    }
  });
});
