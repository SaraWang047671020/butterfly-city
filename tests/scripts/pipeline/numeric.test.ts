import { describe, expect, it } from "vitest";
import {
  apportion,
  codePointCompare,
  linearFit,
  mean,
  median,
  roundTo,
  stableSum,
} from "../../../scripts/pipeline/numeric.ts";

describe("median", () => {
  it("returns the middle value for odd counts, regardless of order", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  it("returns the mean of the two middle values for even counts", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("throws on empty input", () => {
    expect(() => median([])).toThrow();
    expect(() => mean([])).toThrow();
  });
});

describe("roundTo", () => {
  it("normalises -0 to 0", () => {
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
    expect(Object.is(roundTo(-0, 0), 0)).toBe(true);
  });
  it("rounds half away from zero symmetrically", () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(1.23456, 3)).toBe(1.235);
  });
  it("rejects digits outside 0..6", () => {
    expect(() => roundTo(1, 7)).toThrow();
    expect(() => roundTo(1, -1)).toThrow();
  });
});

describe("stableSum / codePointCompare", () => {
  it("is independent of input order", () => {
    expect(stableSum([1e16, 1, -1e16, 1])).toBe(stableSum([1, 1e16, 1, -1e16]));
  });
  it("orders by code point, not UTF-16 unit", () => {
    expect(codePointCompare("\u{1F600}", "\uFF5E")).toBeGreaterThan(0);
    expect(codePointCompare("a", "a")).toBe(0);
    expect(codePointCompare("a", "ab")).toBeLessThan(0);
  });
});

describe("apportion", () => {
  it("splits all-zero weights equally, extra units to the lower indices", () => {
    expect(apportion(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });
  it("uses largest remainder and sums exactly to total", () => {
    const r = apportion(10, [1, 1, 1]);
    expect(r).toEqual([4, 3, 3]);
    expect(apportion(7, [5, 3, 2])).toEqual([4, 2, 1]);
  });
  it("handles zero total and rejects invalid input", () => {
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(() => apportion(1.5, [1])).toThrow();
    expect(() => apportion(1, [-1])).toThrow();
    expect(() => apportion(1, [])).toThrow();
  });
});

describe("linearFit", () => {
  it("recovers an exact line", () => {
    const { slope, intercept } = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(slope).toBeCloseTo(2, 12);
    expect(intercept).toBeCloseTo(1, 12);
  });
  it("throws on degenerate input", () => {
    expect(() => linearFit([1], [1])).toThrow();
    expect(() => linearFit([2, 2], [1, 3])).toThrow();
  });
});
