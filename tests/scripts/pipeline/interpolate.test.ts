import { describe, expect, it } from "vitest";
import { annualToQuarterly } from "../../../scripts/pipeline/interpolate.ts";

function quartersOf(m: Map<string, number>, year: number): number[] {
  return [1, 2, 3, 4].map((q) => m.get(`${year}Q${q}`) as number);
}

describe("annualToQuarterly", () => {
  it("uses the minmod slope on a monotone interior year", () => {
    // 2016: d- = 8, d+ = 16, slope 8 -> 100 + 8 * (-3/8, -1/8, 1/8, 3/8)
    const out = annualToQuarterly(new Map([[2015, 92], [2016, 100], [2017, 116]]));
    expect(quartersOf(out, 2016)).toEqual([97, 99, 101, 103]);
  });

  it("keeps first, last and turning-point years flat", () => {
    const out = annualToQuarterly(new Map([[2015, 10], [2016, 20], [2017, 15], [2018, 15]]));
    expect(quartersOf(out, 2015)).toEqual([10, 10, 10, 10]);
    expect(quartersOf(out, 2016)).toEqual([20, 20, 20, 20]);
    expect(quartersOf(out, 2017)).toEqual([15, 15, 15, 15]);
    expect(quartersOf(out, 2018)).toEqual([15, 15, 15, 15]);
  });

  it("keeps quarters in range and the yearly mean equal to the annual value", () => {
    const out = annualToQuarterly(new Map([[2014, 0], [2015, 4], [2016, 8], [2017, 9]]));
    const q = quartersOf(out, 2016);
    expect(q[0]).toBeGreaterThanOrEqual(4);
    expect(q[3]).toBeLessThanOrEqual(9);
    expect(q.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(8, 12);
  });

  it("returns keys for every input year, including years outside 2015-2025", () => {
    const out = annualToQuarterly(new Map([[2014, 1], [2015, 2]]));
    expect([...out.keys()]).toEqual([
      "2014Q1", "2014Q2", "2014Q3", "2014Q4", "2015Q1", "2015Q2", "2015Q3", "2015Q4",
    ]);
  });

  it("treats a year without a neighbour as an end year and handles an empty series", () => {
    const out = annualToQuarterly(new Map([[2015, 1], [2016, 2], [2018, 5]]));
    expect(quartersOf(out, 2016)).toEqual([2, 2, 2, 2]);
    expect(annualToQuarterly(new Map()).size).toBe(0);
  });

  it("rejects non-finite values", () => {
    expect(() => annualToQuarterly(new Map([[2015, Number.NaN]]))).toThrow();
  });
});
