import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { DistrictSeries } from '../../../scripts/pipeline/indicators/series.ts';
import type { CommuterPassProductRow } from '../../../scripts/pipeline/parsers/policy-tables.ts';
import {
  buildCommuterPassesSold,
  buildCommuterPassPrice,
  buildCommuterPassSubsidy,
  cityPopulation,
  CUMULATIVE_DAYS,
  CUMULATIVE_END,
  PASS_SALES_START,
} from '../../../scripts/pipeline/policy/commuter-pass.ts';
import { dayNumber, type CityTrack } from '../../../scripts/pipeline/policy/track.ts';

const all = quartersBetween();
const idx = (q: Quarter): number => all.indexOf(q);

function product(city: 'Taipei' | 'New Taipei', start: string, price: number): CommuterPassProductRow {
  return { row: 1, city, product: 'p', effectiveDate: start, priceTwd: price, source: 'policy/trtc-products', url: '' };
}
const products: CommuterPassProductRow[] = [
  product('Taipei', '2018-04-16', 1280),
  product('Taipei', '2023-07-01', 1200),
  product('New Taipei', '2018-04-16', 1280),
  product('New Taipei', '2023-07-01', 1200),
];
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const values = (t: CityTrack, city: 'Taipei' | 'New Taipei'): number[] => t[city].map((r) => r.value);

describe('buildCommuterPassPrice', () => {
  const t = buildCommuterPassPrice(products, ['2018Q1', '2018Q2', '2023Q2', '2023Q3']);

  it('takes the product in force on the last day of the quarter, 0 before the first product', () => {
    expect(values(t, 'Taipei')).toEqual([0, 1280, 1280, 1200]);
    expect(values(t, 'New Taipei')).toEqual([0, 1280, 1280, 1200]);
  });

  it('records are observed and carry the product row source', () => {
    expect(t.Taipei[1]).toEqual({ value: 1280, source: 'policy/trtc-products', estimated: false });
    expect(t.Taipei[0]).toEqual({ value: 0, source: 'policy/trtc-products', estimated: false });
  });
});

describe('buildCommuterPassSubsidy', () => {
  it('is 0 in every quarter, estimated with the definition method', () => {
    const t = buildCommuterPassSubsidy(all);
    for (const r of [...t.Taipei, ...t['New Taipei']]) {
      expect(r).toEqual({ value: 0, source: 'policy/trtc-products', estimated: true, method: 'commuter-subsidy-definition' });
    }
    expect(t.Taipei).toHaveLength(44);
  });
});

describe('cityPopulation', () => {
  it('sums the districts of each city per quarter', () => {
    const pop: DistrictSeries = {};
    for (const d of DISTRICTS) pop[d.code] = ['2015Q1', '2015Q2'].map((_, k) => ({ value: d.city === 'Taipei' ? 10 + k : 1, estimated: false }));
    const taipei = DISTRICTS.filter((d) => d.city === 'Taipei').length;
    const result = cityPopulation(pop, DISTRICTS, ['2015Q1', '2015Q2']);
    expect(result.Taipei).toEqual([10 * taipei, 11 * taipei]);
    expect(result['New Taipei']).toEqual([41 - taipei, 41 - taipei]);
  });

  it('stops when a district series is missing', () => {
    expect(() => cityPopulation({}, DISTRICTS, ['2015Q1'])).toThrow(DataError);
  });
});

describe('buildCommuterPassesSold', () => {
  const price = buildCommuterPassPrice(products, all);
  const pop = { Taipei: all.map(() => 600), 'New Taipei': all.map(() => 400) };
  const sold = buildCommuterPassesSold(price, pop, all);
  const from = idx('2018Q2');
  const to = idx('2019Q4');
  const r0 = 5_150_000 / 564;
  // Held-rate part of 2019Q4 (2019-11-01 .. 2019-12-31, 61 days) that sits on top of the exact October part.
  const heldQ4 = (share: number): number => Math.round(r0 * 61 * share);

  it('counts 564 days from 2018-04-16 to 2019-10-31 inclusive', () => {
    expect(CUMULATIVE_DAYS).toBe(564);
    expect(dayNumber(CUMULATIVE_END) - dayNumber(PASS_SALES_START) + 1).toBe(564);
  });

  it('totals exactly 5,150,000 over 2018Q2..2019Q4 for both cities (excluding the held Nov-Dec part)', () => {
    const window = [...values(sold, 'Taipei').slice(from, to + 1), ...values(sold, 'New Taipei').slice(from, to + 1)];
    for (const v of window) expect(Number.isInteger(v)).toBe(true);
    expect(sum(window) - heldQ4(0.6) - heldQ4(0.4)).toBe(5_150_000);
  });

  it('splits the first quarter by active days and population share', () => {
    // 2018Q2 has 76 days from 2018-04-16; Taipei share 0.6: 5,150,000 * 76/564 * 0.6 = 416,382.3...
    expect(Math.abs(sold.Taipei[from]!.value - (r0 * 76 * 0.6))).toBeLessThan(1);
    expect(Math.abs(sold['New Taipei'][from]!.value - r0 * 76 * 0.4)).toBeLessThan(1);
  });

  it('adds the held-rate Nov-Dec days on top of the October part in 2019Q4', () => {
    // October 2019: 31 days of the exact part; Nov-Dec: 61 days at the held rate.
    expect(Math.abs(sold.Taipei[to]!.value - (r0 * 92 * 0.6))).toBeLessThan(1.5);
    expect(Math.abs(sold['New Taipei'][to]!.value - r0 * 92 * 0.4)).toBeLessThan(1.5);
  });

  it('holds the daily rate in later quarters (2020Q1, 91 days)', () => {
    expect(sold.Taipei[idx('2020Q1')]!.value).toBe(Math.round(r0 * 91 * 0.6));
    expect(sold['New Taipei'][idx('2020Q1')]!.value).toBe(Math.round(r0 * 91 * 0.4));
  });
  it('is 0 before the pass price exists', () => {
    for (let k = 0; k < from; k++) {
      expect(sold.Taipei[k]!.value).toBe(0);
      expect(sold['New Taipei'][k]!.value).toBe(0);
    }
  });

  it('marks every record estimated with the passes-sold method', () => {
    for (const r of [...sold.Taipei, ...sold['New Taipei']]) {
      expect(r).toMatchObject({ source: 'policy/taipei-dot-2019', estimated: true, method: 'commuter-passes-estimate' });
    }
  });

  it('is 0 in a city and quarter with a price of 0 and still totals 5,150,000', () => {
    const onlyTaipei = buildCommuterPassPrice(products.filter((p) => p.city === 'Taipei'), all);
    const t = buildCommuterPassesSold(onlyTaipei, pop, all);
    expect(values(t, 'New Taipei').every((v) => v === 0)).toBe(true);
    expect(sum(values(t, 'Taipei').slice(from, to + 1)) - heldQ4(0.6)).toBe(5_150_000);
  });

  it('stops when no quarter of the window has a price or the population is 0', () => {
    const none = buildCommuterPassPrice([], all);
    expect(() => buildCommuterPassesSold(none, pop, all)).toThrow(/no-active-days: commuterPassesSold Taipei 2018Q2/);
    const zero = { Taipei: all.map(() => 0), 'New Taipei': all.map(() => 0) };
    expect(() => buildCommuterPassesSold(price, zero, all)).toThrow(/missing-population: commuterPassesSold Taipei 2018Q2/);
  });
});
