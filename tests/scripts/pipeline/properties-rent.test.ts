import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { City } from "../../../scripts/lib/districts.ts";
import { quartersBetween, type Quarter } from "../../../scripts/lib/time.ts";
import {
  RENT_SALE_RATIO_METHOD,
  RENT_STATS_METHOD,
  buildRent,
  quarterlyCpi,
  type RentInput,
} from "../../../scripts/pipeline/indicators/rent.ts";
import type { CpiRentRow } from "../../../scripts/pipeline/parsers/cpi.ts";
import type { LvrRecord } from "../../../scripts/pipeline/parsers/lvr.ts";
import type { RentReferenceEntry } from "../../../scripts/pipeline/tables/rent-reference.ts";

const NUM_RUNS = 100;
const quarters = quartersBetween();
const idx2024 = quarters.map((q, i) => ({ q, i })).filter((x) => x.q.startsWith("2024Q")).map((x) => x.i);
/** The rent indicator is rounded once to one decimal: at most 0.05 absolute error per value. */
const ROUND_TOL = 0.05;

function record(code: string, quarter: Quarter, p: number, n: number): LvrRecord {
  return {
    id: `${code}-${quarter}-${n}`,
    kind: "rental",
    districtCode: code,
    quarter,
    target: "房地(土地+建物)",
    use: "住家用",
    unitPrice: 0,
    totalPrice: 0,
    rent: p * 10,
    area: 10,
  };
}

function cpiRowsFrom(values: readonly number[]): CpiRentRow[] {
  const rows: CpiRentRow[] = [];
  let k = 0;
  for (let y = 2015; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) rows.push({ yearMonth: `${y}-${String(m).padStart(2, "0")}`, value: values[k++] as number });
  }
  return rows;
}

const cpiArb = fc
  .array(fc.double({ min: 50, max: 200, noNaN: true }), { minLength: 132, maxLength: 132 })
  .map(cpiRowsFrom);
const priceArb = fc.double({ min: 5, max: 200, noNaN: true });
const quarterArb = fc.constantFrom(...quarters);
const recordsArb = (count: { min: number; max: number }) =>
  fc.array(fc.tuple(quarterArb, priceArb), { minLength: count.min, maxLength: count.max });
const price2024Arb = fc.double({ min: 5, max: 200, noNaN: true });

function medianOf(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

describe("rent indicator: properties", () => {
  // Feature: data-pipeline, Property 10: Rent formula reproduces the base level in the base year
  // **Validates: Requirements 9.1, 9.2, 9.3**
  it("Property 10: rent formula reproduces the base level in the base year", () => {
    const districts = [
      { code: "T1", city: "Taipei" as City },
      { code: "T2", city: "Taipei" as City },
      { code: "N1", city: "New Taipei" as City },
      { code: "N2", city: "New Taipei" as City },
    ];
    const scenario = fc.record({
      t1: recordsArb({ min: 30, max: 40 }),
      t2: recordsArb({ min: 30, max: 40 }),
      n1: recordsArb({ min: 30, max: 40 }),
      n2: recordsArb({ min: 30, max: 40 }),
      baseT: price2024Arb,
      baseN: price2024Arb,
      cpiT: cpiArb,
      cpiN: cpiArb,
    });
    fc.assert(
      fc.property(scenario, (s) => {
        const toRecords = (code: string, list: readonly (readonly [Quarter, number])[]) =>
          list.map(([q, p], i) => record(code, q, p, i));
        const rentals: LvrRecord[] = [
          ...toRecords("T1", s.t1),
          ...toRecords("T2", s.t2),
          ...toRecords("N1", s.n1),
          ...toRecords("N2", s.n2),
          // Guarantee at least one lease in the base year for each city.
          record("T1", "2024Q2", s.baseT, 1000),
          record("N1", "2024Q2", s.baseN, 1000),
        ];
        const cpi = { Taipei: s.cpiT, "New Taipei": s.cpiN };
        const input: RentInput = { rentals, districts, quarters, cpi, stats: [], adjacency: new Map(), referenceTable: {} };

        // City quarter index = mean of its three months.
        for (const city of ["Taipei", "New Taipei"] as const) {
          const q = quarterlyCpi(city, cpi[city], quarters);
          expect(q).toHaveLength(44);
          for (let i = 0; i < 44; i++) {
            const months = cpi[city].slice(i * 3, i * 3 + 3).map((r) => r.value);
            const expected = (months[0]! + months[1]! + months[2]!) / 3;
            expect(Math.abs((q[i] as number) - expected)).toBeLessThanOrEqual(1e-12 * expected);
          }
        }

        // Independent recomputation of rel(d) * base(c).
        const { series } = buildRent(input);
        for (const d of districts) {
          const inCity = rentals.filter((r) => districts.find((x) => x.code === r.districtCode)?.city === d.city);
          const own = rentals.filter((r) => r.districtCode === d.code);
          const rel = medianOf(own.map((r) => r.rent / r.area)) / medianOf(inCity.map((r) => r.rent / r.area));
          const base = medianOf(inCity.filter((r) => r.quarter?.startsWith("2024Q")).map((r) => r.rent / r.area));
          const values = (series[d.code] ?? []).map((r) => r.value as number);
          const meanBase = idx2024.reduce((acc, i) => acc + (values[i] as number), 0) / 4;
          // Values are rounded to 1 decimal, so the exact 1e-12 tolerance is relaxed to the rounding error.
          expect(Math.abs(meanBase - rel * base)).toBeLessThanOrEqual(ROUND_TOL + 1e-9);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 11: Reference districts follow their reference by a constant ratio
  // **Validates: Requirements 9.4, 9.5**
  it("Property 11: reference districts follow their reference by a constant ratio", () => {
    const districts = [
      { code: "T1", city: "Taipei" as City },
      { code: "N1", city: "New Taipei" as City },
      { code: "N2", city: "New Taipei" as City },
      { code: "N3", city: "New Taipei" as City },
    ];
    const table: Record<string, RentReferenceEntry> = {
      N2: { reference: "N1", relation: "borders", expectedRatioMethod: "rent-statistics" },
      N3: { reference: "N1", relation: "borders", expectedRatioMethod: "sale-price" },
    };
    const adjacency = new Map([
      ["N1", ["N2", "N3"]],
      ["N2", ["N1"]],
      ["N3", ["N1"]],
    ]);
    const positive = fc.double({ min: 1000, max: 50000, noNaN: true });
    const sale = fc.array(fc.double({ min: 100, max: 5000, noNaN: true }), { minLength: 44, maxLength: 44 });
    const scenario = fc.record({
      t1: recordsArb({ min: 30, max: 35 }),
      n1: recordsArb({ min: 30, max: 40 }),
      baseT: price2024Arb,
      baseN: price2024Arb,
      cpiT: cpiArb,
      cpiN: cpiArb,
      p50N1: positive,
      p50N2: positive,
      saleN1: sale,
      saleN3: sale,
      oneN2: priceArb,
      oneN3: priceArb,
    });
    fc.assert(
      fc.property(scenario, (s) => {
        const rentals: LvrRecord[] = [
          ...s.t1.map(([q, p], i) => record("T1", q, p, i)),
          ...s.n1.map(([q, p], i) => record("N1", q, p, i)),
          record("T1", "2024Q2", s.baseT, 1000),
          record("N1", "2024Q2", s.baseN, 1000),
          record("N2", "2020Q1", s.oneN2, 0),
          record("N3", "2020Q1", s.oneN3, 0),
        ];
        const input: RentInput = {
          rentals,
          districts,
          quarters,
          cpi: { Taipei: s.cpiT, "New Taipei": s.cpiN },
          stats: [
            { districtCode: "N1", contracts: 100, p50: s.p50N1 },
            { districtCode: "N2", contracts: 100, p50: s.p50N2 },
          ],
          adjacency,
          salePriceUnrounded: new Map([
            ["N1", s.saleN1],
            ["N2", s.saleN1],
            ["N3", s.saleN3],
          ]),
          referenceTable: table,
        };
        const { series, references } = buildRent(input);
        const mean2024 = (v: readonly number[]) => idx2024.reduce((a, i) => a + (v[i] as number), 0) / 4;
        const expected = {
          N2: { ratio: s.p50N2 / s.p50N1, method: RENT_STATS_METHOD },
          N3: { ratio: mean2024(s.saleN3) / mean2024(s.saleN1), method: RENT_SALE_RATIO_METHOD },
        };
        for (const code of ["N2", "N3"] as const) {
          const e = expected[code];
          const info = references.find((r) => r.district === code);
          expect(info?.method).toBe(e.method);
          expect(Math.abs((info?.ratio as number) - e.ratio)).toBeLessThanOrEqual(1e-12 * e.ratio);
          const own = series[code] ?? [];
          const ref = series["N1"] ?? [];
          expect(own).toHaveLength(44);
          for (let i = 0; i < 44; i++) {
            expect(own[i]).toMatchObject({ estimated: true, method: e.method });
            // own = round(unroundedRef * ratio); ref is itself rounded (error <= 0.05).
            const diff = Math.abs((own[i]?.value as number) - e.ratio * (ref[i]?.value as number));
            expect(diff).toBeLessThanOrEqual(ROUND_TOL + e.ratio * ROUND_TOL + 1e-9);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
