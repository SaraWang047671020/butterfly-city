import { describe, expect, it } from 'vitest';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { memoryLogger, type BuildContext } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { lvrPaths } from '../../../scripts/pipeline/indicators/lvr-input.ts';
import {
  buildMedianTotalPrice,
  medianTotalPriceStep,
  TOTAL_PRICE_POOLED_METHOD,
} from '../../../scripts/pipeline/indicators/median-total-price.ts';
import { buildSalePrice } from '../../../scripts/pipeline/indicators/sale-price.ts';
import type { LvrRecord } from '../../../scripts/pipeline/parsers/lvr.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

const quarters = quartersBetween();
const Q = (q: Quarter) => quarters.indexOf(q);

let seq = 0;
function sale(districtCode: string, quarter: Quarter, totalPrice: number, unitPrice = 100): LvrRecord {
  return {
    id: `${districtCode}-${quarter}-${seq++}`,
    kind: 'sale',
    districtCode,
    quarter,
    target: '房地(土地+建物)',
    use: '住家用',
    unitPrice,
    totalPrice,
    rent: 0,
    area: 50,
  };
}

const totals = (code: string, quarter: Quarter, values: number[]): LvrRecord[] => values.map((v) => sale(code, quarter, v));

describe('buildMedianTotalPrice', () => {
  it('uses the own median, not estimated and with no method, for exactly 10 sales', () => {
    const r = buildMedianTotalPrice(
      totals('A', '2020Q1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((n) => n * 1000)),
      [{ code: 'A' }],
      quarters,
    );
    const cell = r.series['A']?.[Q('2020Q1')];
    expect(cell).toEqual({ value: 5500, estimated: false });
    expect(cell).not.toHaveProperty('method');
    expect(r.windowCounts.get('A')?.get(0)).toBe(1);
  });

  it('pools a radius-1 window when a district-quarter has fewer than 10 sales', () => {
    const sales = [
      ...totals('B', '2020Q1', [10, 20, 30, 40]),
      ...totals('B', '2020Q2', [50, 60, 70]),
      ...totals('B', '2020Q3', [80, 90, 100]),
    ];
    const r = buildMedianTotalPrice(sales, [{ code: 'B' }], quarters);
    // 2020Q2 window 2020Q1..Q3 holds 10 sales: median (50 + 60) / 2.
    expect(r.series['B']?.[Q('2020Q2')]).toEqual({ value: 55, estimated: true, method: 'median-total-price-pooled-window' });
    expect(TOTAL_PRICE_POOLED_METHOD).toBe('median-total-price-pooled-window');
    expect(r.windowCounts.get('B')?.get(1)).toBe(1);
  });

  it('excludes a sale with total price 0 from the median total price but not from the sale price', () => {
    // 10 sales with unit price 100..109; the one with unit price 109 has total price 0.
    const sales = Array.from({ length: 10 }, (_, i) => sale('A', '2020Q1', i === 9 ? 0 : (i + 1) * 100, 100 + i));
    const sale10 = buildSalePrice(sales, [{ code: 'A' }], quarters);
    expect(sale10.series['A']?.[Q('2020Q1')]).toEqual({ value: 105, estimated: false }); // 100..109, all 10 count
    const r = buildMedianTotalPrice(sales, [{ code: 'A' }], quarters);
    // Only 9 positive totals (100..900), so the cell is pooled with its neighbours: median 500.
    expect(r.series['A']?.[Q('2020Q1')]).toEqual({ value: 500, estimated: true, method: TOTAL_PRICE_POOLED_METHOD });
    expect(r.zeroTotalPrice).toBe(1);
  });

  it('averages the two middle values for an even count and rounds .5 away from zero', () => {
    // Total prices 1000..1009 (10 values): middle values 1004 and 1005, median 1004.5 -> 1005.
    const r = buildMedianTotalPrice(
      totals('A', '2020Q1', Array.from({ length: 10 }, (_, i) => 1000 + i)),
      [{ code: 'A' }],
      quarters,
    );
    expect(r.series['A']?.[Q('2020Q1')]).toEqual({ value: 1005, estimated: false });
  });

  it('throws no-sales-for-median-total-price naming the district and quarter when no total price is positive', () => {
    let error: unknown;
    try {
      buildMedianTotalPrice(
        [...totals('A', '2020Q1', [100, 200, 300]), ...totals('D', '2020Q1', [0, 0, 0])],
        [{ code: 'A' }, { code: 'D' }],
        quarters,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain('no-sales-for-median-total-price');
    expect((error as DataError).subject).toBe('district D 2015Q1');
  });
});

describe('medianTotalPriceStep', () => {
  const header = '鄉鎮市區,交易標的,交易年月日,建物移轉總面積平方公尺,主要用途,總價元,單價元平方公尺,編號\nen,en,en,en,en,en,en,en\n';
  const row = (id: string, unit: number, total: number) => `大安區,房地(土地+建物),1090115,50,住家用,${total},${unit},${id}`;

  it('sets both state fields and notes how many qualifying sales were excluded', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`id${i}`, 100 + i, (i + 1) * 1000));
    rows.push(row('zero', 200, 0));
    const all: Record<string, string> = {};
    for (const p of lvrPaths('sale')) all[p] = header;
    all['lvr/104S1_a_lvr_land_a.csv'] = header + rows.join('\n') + '\n';
    const ctx = {
      reader: new MemoryRawReader(all),
      districts: [{ code: '63000030', city: 'Taipei', zh: '臺北市大安區', name: "Da'an" }],
      quarters,
      logger: memoryLogger(),
    } as BuildContext;
    const state = createState();
    medianTotalPriceStep().run(ctx, state);
    expect(state.medianTotalPrice?.['63000030']?.[Q('2020Q1')]).toEqual({ value: 5500, estimated: false });
    expect(state.medianTotalPriceWindowCounts?.get('63000030')?.get(0)).toBe(1);
    expect(state.notes).toContain('median total price: 1 qualifying sales excluded, 總價元 not greater than 0');
  });
});
