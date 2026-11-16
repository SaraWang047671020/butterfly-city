import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { annualToQuarterly } from "../../../scripts/pipeline/interpolate.ts";
import { apportion, roundTo, stableSum } from "../../../scripts/pipeline/numeric.ts";
import { formatNumber, serializeJson } from "../../../scripts/pipeline/serialize.ts";

const NUM_RUNS = 200;

describe("pipeline shared helpers: properties", () => {
  // Feature: data-pipeline, Property 1: Interpolation preserves the annual mean and stays within neighbouring values
  // **Validates: Requirements 7.1, 7.6, 18.5**
  it("Property 1: interpolation preserves the annual mean and stays within neighbouring values", () => {
    const seriesArb = fc
      .integer({ min: 1, max: 11 })
      .chain((len) =>
        fc.record({
          start: fc.integer({ min: 2015, max: 2025 - len + 1 }),
          values: fc.array(fc.double({ min: 0, max: 1_000_000_000, noNaN: true }), {
            minLength: len,
            maxLength: len,
          }),
        }),
      );
    fc.assert(
      fc.property(seriesArb, ({ start, values }) => {
        const series = new Map<number, number>(values.map((v, i) => [start + i, v]));
        const out = annualToQuarterly(series);
        expect(out.size).toBe(values.length * 4);
        values.forEach((a, i) => {
          const year = start + i;
          const qs = [1, 2, 3, 4].map((k) => {
            const q = out.get(`${year}Q${k as 1 | 2 | 3 | 4}`);
            expect(q).toBeDefined();
            expect(Number.isFinite(q)).toBe(true);
            return q as number;
          });
          const avg = stableSum(qs) / 4;
          expect(Math.abs(avg - a)).toBeLessThanOrEqual(1e-12 * Math.max(Math.abs(a), Number.MIN_VALUE));
          const near = [a, values[i - 1], values[i + 1]].filter((v): v is number => v !== undefined);
          const lo = Math.min(...near);
          const hi = Math.max(...near);
          for (const q of qs) {
            expect(q).toBeGreaterThanOrEqual(lo);
            expect(q).toBeLessThanOrEqual(hi);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 2: Apportionment yields non-negative integers that sum to the total
  // **Validates: Requirements 6.3, 11.14**
  it("Property 2: apportionment yields non-negative integers that sum to the total", () => {
    const weightArb = fc.oneof(
      fc.constant(0),
      fc.double({ min: 1e-6, max: 1_000_000_000, noNaN: true }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(weightArb, { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const out = apportion(total, weights);
          expect(out).toHaveLength(weights.length);
          let sum = 0;
          for (const n of out) {
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(0);
            sum += n;
          }
          expect(sum).toBe(total);
          const allZero = weights.every((w) => w === 0);
          const eff = allZero ? weights.map(() => 1) : weights;
          const W = stableSum(eff);
          eff.forEach((w, i) => {
            expect(Math.abs((out[i] as number) - (total * w) / W)).toBeLessThan(1);
            if (!allZero && w === 0) expect(out[i]).toBe(0);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 22: Number and text formatting
  // **Validates: Requirements 17.3, 17.5**
  it("Property 22: formatNumber output is canonical and parses back to roundTo(x, d)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e15, max: 1e15, noNaN: true }),
        fc.integer({ min: 0, max: 6 }),
        (x, d) => {
          const s = formatNumber(x, d);
          expect(s).toMatch(/^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/);
          expect(s).not.toBe("-0");
          expect(Number(s)).toBe(roundTo(x, d));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 22: Number and text formatting
  // **Validates: Requirements 17.3, 17.5**
  it("Property 22: serializeJson has no CR, no BOM, and exactly one trailing LF", () => {
    const { value } = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: "small", maxDepth: 3 },
        fc.constant(null),
        fc.boolean(),
        // Serializable numbers are the rounded ones the pipeline emits (no exponent tokens).
        fc.double({ min: -1e15, max: 1e15, noNaN: true }).map((x) => roundTo(x, 6)),
        fc.string({ unit: "binary" }),
        fc.array(tie("value"), { maxLength: 5 }),
        fc.dictionary(fc.string({ unit: "binary" }), tie("value"), { maxKeys: 5 }),
      ),
    }));
    fc.assert(
      fc.property(value, (v) => {
        const text = serializeJson(v);
        expect(text).not.toContain("\r");
        expect(text.startsWith("\uFEFF")).toBe(false);
        expect(text.endsWith("\n")).toBe(true);
        expect(text.endsWith("\n\n")).toBe(false);
        expect(text.indexOf("\n", text.length - 1)).toBe(text.length - 1);
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30_000);
});
