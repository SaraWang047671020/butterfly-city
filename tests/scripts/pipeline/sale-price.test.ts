import { describe, expect, it } from 'vitest';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { memoryLogger, type BuildContext } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { loadLvr, lvrPaths } from '../../../scripts/pipeline/indicators/lvr-input.ts';
import { buildSalePrice, salePriceStep, SALE_POOLED_METHOD } from '../../../scripts/pipeline/indicators/sale-price.ts';
import type { LvrRecord } from '../../../scripts/pipeline/parsers/lvr.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

const quarters = quartersBetween();

function sale(districtCode: string, quarter: Quarter, unitPrice: number): LvrRecord {
  return {
    id: `${districtCode}-${quarter}-${unitPrice}`,
    kind: 'sale',
    districtCode,
    quarter,
    target: '房地(土地+建物)',
    use: '住家用',
    unitPrice,
    totalPrice: unitPrice * 50,
    rent: 0,
    area: 50,
  };
}

const many = (code: string, quarter: Quarter, prices: number[]): LvrRecord[] => prices.map((p) => sale(code, quarter, p));

describe('buildSalePrice', () => {
  it('uses the own median, not estimated, when a district-quarter has at least 10 sales', () => {
    const prices = Array.from({ length: 11 }, (_, i) => 100 + i); // 100..110, median 105
    const r = buildSalePrice(many('A', '2020Q1', prices), [{ code: 'A' }], quarters);
    const cell = r.series['A']?.[quarters.indexOf('2020Q1')];
    expect(cell).toEqual({ value: 105, estimated: false });
    expect(r.windowCounts.get('A')?.get(0)).toBe(1);
  });

  it('averages the two middle values for an even count and rounds to whole TWD', () => {
    const prices = Array.from({ length: 10 }, (_, i) => 100 + i); // 100..109, median 104.5 -> 105
    const r = buildSalePrice(many('A', '2020Q1', prices), [{ code: 'A' }], quarters);
    expect(r.series['A']?.[quarters.indexOf('2020Q1')]).toEqual({ value: 105, estimated: false });
  });

  it('pools a symmetric window for thin cells, smallest radius first', () => {
    // 2020Q1: 4 sales, 2020Q2: 3 sales, 2020Q3: 3 sales.
    const sales = [
      ...many('B', '2020Q1', [10, 20, 30, 40]),
      ...many('B', '2020Q2', [50, 60, 70]),
      ...many('B', '2020Q3', [80, 90, 100]),
    ];
    const r = buildSalePrice(sales, [{ code: 'B' }], quarters);
    const at = (q: Quarter) => r.series['B']?.[quarters.indexOf(q)];
    // 2020Q2: radius 1 covers 2020Q1..Q3 = 10 sales, median (50 + 60) / 2 = 55.
    expect(at('2020Q2')).toEqual({ value: 55, estimated: true, method: SALE_POOLED_METHOD });
    // 2020Q1: radius 1 holds 7 sales, radius 2 (2019Q3..2020Q3) holds 10, same median.
    expect(at('2020Q1')).toEqual({ value: 55, estimated: true, method: SALE_POOLED_METHOD });
    expect(at('2020Q3')).toEqual({ value: 55, estimated: true, method: SALE_POOLED_METHOD });
    const counts = r.windowCounts.get('B') as Map<number, number>;
    expect(counts.get(1)).toBe(1);
    expect(counts.get(2)).toBe(2);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(44);
    for (const rec of r.series['B'] ?? []) expect(rec.estimated).toBe(true);
  });

  it('widens to the full period when fewer than 10 sales exist overall', () => {
    const r = buildSalePrice(many('C', '2020Q1', [1, 2, 3, 4, 5]), [{ code: 'C' }], quarters);
    for (const rec of r.series['C'] ?? []) expect(rec).toEqual({ value: 3, estimated: true, method: SALE_POOLED_METHOD });
    // 2020Q1 (index 20) and 2020Q4 (index 23) both need radius 23 to cover all 44 quarters.
    expect(r.windowCounts.get('C')?.get(23)).toBe(2);
  });

  it('stops with the district and quarter when the widest window has no sales', () => {
    let error: unknown;
    try {
      buildSalePrice(many('A', '2020Q1', [1, 2, 3]), [{ code: 'A' }, { code: 'D' }], quarters);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).subject).toBe('district D 2015Q1');
  });
});

describe('salePriceStep', () => {
  const header = '鄉鎮市區,交易標的,交易年月日,建物移轉總面積平方公尺,主要用途,總價元,單價元平方公尺,編號\nen,en,en,en,en,en,en,en\n';
  const row = (id: string, date: string, unit: number, use = '住家用') =>
    `大安區,房地(土地+建物),${date},50,${use},${unit * 50},${unit},${id}`;

  function context(files: Record<string, string>): BuildContext {
    const all: Record<string, string> = {};
    for (const p of lvrPaths('sale')) all[p] = header;
    return {
      reader: new MemoryRawReader({ ...all, ...files }),
      districts: [{ code: '63000030', city: 'Taipei', zh: '臺北市大安區', name: "Da'an" }],
      quarters,
      logger: memoryLogger(),
    } as BuildContext;
  }

  it('reads all sale files, de-duplicates by id, filters, and reports exclusions', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`id${i}`, '1090115', 100 + i));
    const files = {
      'lvr/104S1_a_lvr_land_a.csv': header + [...rows, row('id0', '1090115', 999), row('x', '1090115', 500, '商業用')].join('\n') + '\n',
      'lvr/104S2_a_lvr_land_a.csv': header + row('id1', '1090115', 888) + '\n', // duplicate of id1
    };
    const ctx = context(files);
    const load = loadLvr(ctx, 'sale');
    expect(load.duplicates).toBe(2);
    expect(load.exclusions['non-residential']).toBe(1);
    expect(load.qualifying).toHaveLength(10);

    const state = createState();
    salePriceStep().run(ctx, state);
    expect(state.salePrice?.['63000030']?.[quarters.indexOf('2020Q1')]).toEqual({ value: 105, estimated: false });
    expect(state.salePriceWindowCounts?.get('63000030')?.get(0)).toBe(1);
    expect(state.notes).toContain('sale records excluded, duplicate: 2');
    expect(state.notes).toContain('sale records excluded, non-residential: 1');
  });
});
