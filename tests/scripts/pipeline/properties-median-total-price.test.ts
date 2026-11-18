import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { quartersBetween, type Quarter } from "../../../scripts/lib/time.ts";
import { buildSalePrice } from "../../../scripts/pipeline/indicators/sale-price.ts";
import { TOTAL_PRICE_POOLED_METHOD, buildMedianTotalPrice } from "../../../scripts/pipeline/indicators/median-total-price.ts";
import type { LvrRecord } from "../../../scripts/pipeline/parsers/lvr.ts";

const NUM_RUNS = 100;
const TIMEOUT = 120_000;
const MIN_COUNT = 10;
const quarters = quartersBetween();
const districts = [{ code: "6300100" }, { code: "6500200" }];

function sale(code: string, quarter: Quarter, totalPrice: number, n: number): LvrRecord {
  return {
    id: `${code}-${quarter}-${n}`,
    kind: "sale",
    districtCode: code,
    quarter,
    target: "房地(土地+建物)",
    use: "住家用",
    unitPrice: 300000,
    totalPrice,
    rent: 0,
    area: 30,
  };
}

/** Reference median, rounded to 0 decimals (values are integers, so a half is always positive). */
function refMedian(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const m = s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  return Math.round(m);
}

/** Independent reference: per-cell positive totals -> expected [value, pooled] per quarter. */
function reference(cells: readonly (readonly number[])[]): { value: number; pooled: boolean }[] {
  const last = cells.length - 1;
  return cells.map((own, i) => {
    if (own.length >= MIN_COUNT) return { value: refMedian(own), pooled: false };
    for (let r = 1; r <= last; r++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(last, i + r);
      const pool = cells.slice(lo, hi + 1).flat();
      if (pool.length >= MIN_COUNT || (lo === 0 && hi === last)) return { value: refMedian(pool), pooled: true };
    }
    throw new Error("unreachable");
  });
}

const qIdxArb = fc.integer({ min: 0, max: quarters.length - 1 });
const priceArb = fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 1, max: 200_000_000 }) }, { weight: 1, arbitrary: fc.constant(0) });
const positiveArb = fc.integer({ min: 1, max: 200_000_000 });

/** Quarter index, total price pairs for one district; the first sale always has a positive total price. */
const districtSalesArb = fc.tuple(
  fc.tuple(qIdxArb, positiveArb),
  fc.oneof(
    { weight: 3, arbitrary: fc.array(fc.tuple(qIdxArb, priceArb), { maxLength: 60 }) },
    // Dense clustering so own-quarter medians (>= 10 sales) occur.
    { weight: 2, arbitrary: fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), priceArb), { minLength: 20, maxLength: 120 }) },
  ),
);

const salesArb = fc.tuple(districtSalesArb, districtSalesArb);

function toRecords(input: readonly (readonly [readonly [number, number], readonly (readonly [number, number])[]])[]): LvrRecord[] {
  const out: LvrRecord[] = [];
  let n = 0;
  input.forEach(([first, rest], d) => {
    const code = (districts[d] as { code: string }).code;
    for (const [qi, p] of [first, ...rest]) out.push(sale(code, quarters[qi] as Quarter, p, n++));
  });
  return out;
}

describe("Property 35: Median total price medians, thin-cell flags and pooled windows", () => {
  it(
    "matches the reference medians, flags and windows, and zero total prices change nothing",
    () => {
      fc.assert(
        fc.property(salesArb, (input) => {
          const sales = toRecords(input);
          const positive = sales.filter((r) => r.totalPrice > 0);
          const { series } = buildMedianTotalPrice(sales, districts, quarters);
          const withoutZero = buildMedianTotalPrice(positive, districts, quarters).series;
          let ok = JSON.stringify(series) === JSON.stringify(withoutZero);
          for (const d of districts) {
            const records = series[d.code] ?? [];
            ok &&= records.length === quarters.length;
            const cells: number[][] = quarters.map(() => []);
            for (const r of positive) {
              if (r.districtCode === d.code) (cells[quarters.indexOf(r.quarter as Quarter)] as number[]).push(r.totalPrice);
            }
            const expected = reference(cells);
            expected.forEach((e, i) => {
              const rec = records[i];
              if (rec === undefined || rec.value !== e.value) ok = false;
              else if (e.pooled) ok &&= rec.estimated === true && rec.method === TOTAL_PRICE_POOLED_METHOD;
              else ok &&= rec.estimated === false && !("method" in rec);
            });
          }
          expect(ok).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );
});

function serialize(m: Map<string, Map<number, number>>): string {
  return JSON.stringify([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort(([a], [b]) => a - b)]));
}

describe("Property 36: Median total price uses the sale price window rule", () => {
  it(
    "reports the same window counts as the sale price builder when every total price is positive",
    () => {
      fc.assert(
        fc.property(salesArb, (input) => {
          const sales = toRecords(input).filter((r) => r.totalPrice > 0);
          const total = buildMedianTotalPrice(sales, districts, quarters).windowCounts;
          const unit = buildSalePrice(sales, districts, quarters).windowCounts;
          expect(serialize(total) === serialize(unit)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT,
  );
});
