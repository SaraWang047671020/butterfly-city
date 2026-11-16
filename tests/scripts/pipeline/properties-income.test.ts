import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween } from '../../../scripts/lib/time.ts';
import {
  buildIncome,
  buildIncomeUnrounded,
  extendRelativeIncome,
  relativeIncomeByYear,
} from '../../../scripts/pipeline/indicators/income.ts';
import { linearFit, roundTo } from '../../../scripts/pipeline/numeric.ts';
import type { DgbasCityIncomeRow, FiaDistrictRow } from '../../../scripts/pipeline/parsers/income.ts';

const quarters = quartersBetween();
const N = DISTRICTS.length;
const YEARS = 10; // income years 2014..2023

/** 10 years x 41 districts of positive medians; the range keeps extrapolated values positive. */
const mediansArb = fc.array(fc.integer({ min: 80, max: 120 }), { minLength: N * YEARS, maxLength: N * YEARS });
const dgbasArb = fc.array(fc.tuple(fc.integer({ min: 500_000, max: 2_000_000 }), fc.integer({ min: 500_000, max: 2_000_000 })), {
  minLength: 12,
  maxLength: 12,
});

function toFia(flat: readonly number[]): Map<number, FiaDistrictRow[]> {
  const out = new Map<number, FiaDistrictRow[]>();
  for (let yi = 0; yi < YEARS; yi++) {
    const year = 2014 + yi;
    out.set(
      year,
      DISTRICTS.map((d, i) => ({ districtCode: d.code, incomeYear: year, households: 1000, median: flat[yi * N + i] as number })),
    );
  }
  return out;
}

function toDgbas(pairs: readonly (readonly [number, number])[]): DgbasCityIncomeRow[] {
  return pairs.map(([taipei, newTaipei], i) => ({ year: 2014 + i, taipei, newTaipei }));
}

describe('income properties', () => {
  // Feature: data-pipeline, Property 5: Relative income is scale-invariant per income year and composes into household income
  it('Property 5: relative income is scale-invariant per income year and composes into household income', () => {
    // **Validates: Requirements 7.2, 7.3, 7.4, 7.7**
    fc.assert(
      fc.property(
        mediansArb,
        dgbasArb,
        fc.integer({ min: 2014, max: 2023 }),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        fc.integer({ min: -10, max: 10 }),
        (flat, dg, scaledYear, k, exp) => {
          const base = toFia(flat);
          const scaleYear = (kk: number) => {
            const m = new Map(base);
            m.set(
              scaledYear,
              base.get(scaledYear)!.map((r) => ({ ...r, median: r.median * kk })),
            );
            return m;
          };
          const a = relativeIncomeByYear(base, DISTRICTS);
          const b = relativeIncomeByYear(scaleYear(k), DISTRICTS);
          for (const [code, years] of a) {
            for (const [y, v] of years) {
              const w = b.get(code)!.get(y)!;
              expect(Math.abs(w - v)).toBeLessThanOrEqual(1e-12 * Math.abs(v));
            }
          }

          // power-of-two scaling is exact, so the rounded outputs are identical
          const p = 2 ** exp;
          const dgbas = toDgbas(dg);
          const s1 = buildIncome(base, dgbas, DISTRICTS, quarters);
          const s2 = buildIncome(scaleYear(p), dgbas, DISTRICTS, quarters);
          expect(s2).toEqual(s1);

          // household income = city income x relative income before rounding
          const u = buildIncomeUnrounded(base, dgbas, DISTRICTS, quarters);
          for (const d of DISTRICTS) {
            quarters.forEach((q, i) => {
              const exact = u.city.get(d.city)!.get(q)! * u.relative.get(d.code)!.get(q)!;
              expect(u.household.get(d.code)!.get(q)).toBe(exact);
              expect(s1.householdIncome[d.code]![i]!.value).toBe(roundTo(exact, 0));
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);

  // Feature: data-pipeline, Property 6: Income extrapolation ignores income years before 2019
  it('Property 6: income extrapolation ignores income years before 2019', () => {
    // **Validates: Requirements 7.5**
    fc.assert(
      fc.property(mediansArb, mediansArb, dgbasArb, (flat, other, dg) => {
        const base = toFia(flat);
        // replace income years 2014..2018 (the first five years) with arbitrary values
        const changedFlat = flat.map((v, i) => (i < 5 * N ? (other[i] as number) : v));
        const changed = toFia(changedFlat);

        const relBase = extendRelativeIncome(relativeIncomeByYear(base, DISTRICTS));
        const relChanged = extendRelativeIncome(relativeIncomeByYear(changed, DISTRICTS));
        const xs = [2019, 2020, 2021, 2022, 2023];
        for (const d of DISTRICTS) {
          const yb = relBase.get(d.code)!;
          const yc = relChanged.get(d.code)!;
          // independent ordinary least squares over 2019..2023
          const ys = xs.map((y) => yb.get(y)!);
          const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
          const my = ys.reduce((s, y) => s + y, 0) / ys.length;
          let sxy = 0;
          let sxx = 0;
          xs.forEach((x, i) => {
            sxy += (x - mx) * (ys[i]! - my);
            sxx += (x - mx) ** 2;
          });
          const slope = sxy / sxx;
          const fit = linearFit(xs, ys);
          expect(Math.abs(fit.slope - slope)).toBeLessThanOrEqual(1e-9);
          for (const y of [2024, 2025]) {
            expect(yc.get(y)).toBe(yb.get(y));
            const onLine = my + slope * (y - mx);
            expect(Math.abs(yb.get(y)! - onLine)).toBeLessThanOrEqual(1e-9);
          }
        }

        // quarterly values of 2024 and 2025 are unchanged too
        const dgbas = toDgbas(dg);
        const ub = buildIncomeUnrounded(base, dgbas, DISTRICTS, quarters);
        const uc = buildIncomeUnrounded(changed, dgbas, DISTRICTS, quarters);
        for (const d of DISTRICTS) {
          for (const q of quarters.filter((x) => Number(x.slice(0, 4)) >= 2024)) {
            expect(uc.relative.get(d.code)!.get(q)).toBe(ub.relative.get(d.code)!.get(q));
          }
        }
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
