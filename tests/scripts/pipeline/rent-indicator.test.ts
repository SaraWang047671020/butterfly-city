import { describe, expect, it } from 'vitest';
import type { City } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { RENT_CPI_METHOD, RENT_SALE_RATIO_METHOD, RENT_STATS_METHOD, buildRent, monthsOf, type RentInput } from '../../../scripts/pipeline/indicators/rent.ts';
import { buildSalePrice } from '../../../scripts/pipeline/indicators/sale-price.ts';
import type { CpiRentRow } from '../../../scripts/pipeline/parsers/cpi.ts';
import type { LvrRecord } from '../../../scripts/pipeline/parsers/lvr.ts';
import type { RentReferenceEntry } from '../../../scripts/pipeline/tables/rent-reference.ts';

const quarters = quartersBetween();
const districts = [
  { code: 'T1', city: 'Taipei' as City },
  { code: 'T2', city: 'Taipei' as City },
  { code: 'N1', city: 'New Taipei' as City },
  { code: 'N2', city: 'New Taipei' as City },
  { code: 'N3', city: 'New Taipei' as City },
];

function rental(code: string, quarter: Quarter, pricePerM2: number, count: number): LvrRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${code}-${quarter}-${i}`,
    kind: 'rental' as const,
    districtCode: code,
    quarter,
    target: '房地(土地+建物)',
    use: '住家用',
    unitPrice: 0,
    totalPrice: 0,
    rent: pricePerM2 * 10,
    area: 10,
  }));
}

/** Monthly CPI rows 2015-01..2025-12: `base` through 2024, `later` in 2025; optional missing month. */
function cpiRows(base: number, later: number, skip?: string): CpiRentRow[] {
  const rows: CpiRentRow[] = [];
  for (let y = 2015; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      const yearMonth = `${y}-${String(m).padStart(2, '0')}`;
      if (yearMonth !== skip) rows.push({ yearMonth, value: y === 2025 ? later : base });
    }
  }
  return rows;
}

const rentals: LvrRecord[] = [
  ...rental('T1', '2024Q1', 30, 30),
  ...rental('T2', '2023Q1', 60, 30),
  ...rental('N1', '2024Q2', 20, 30),
  ...rental('N2', '2020Q1', 10, 1),
  ...rental('N3', '2020Q1', 10, 1),
];

const table: Record<string, RentReferenceEntry> = {
  N2: { reference: 'N1', relation: 'borders', expectedRatioMethod: 'rent-statistics' },
  N3: { reference: 'N1', relation: 'borders', expectedRatioMethod: 'sale-price' },
};

const flat = (value: number) => quarters.map(() => value);

function input(overrides: Partial<RentInput> = {}): RentInput {
  return {
    rentals,
    districts,
    quarters,
    cpi: { Taipei: cpiRows(100, 110), 'New Taipei': cpiRows(200, 200) },
    stats: [
      { districtCode: 'N1', contracts: 100, p50: 10000 },
      { districtCode: 'N2', contracts: 50, p50: 7500 },
    ],
    adjacency: new Map([
      ['N1', ['N2', 'N3']],
      ['N2', ['N1']],
      ['N3', ['N1']],
    ]),
    salePriceUnrounded: new Map([
      ['N1', flat(800)],
      ['N3', flat(500)],
      ['N2', flat(600)],
    ]),
    referenceTable: table,
    ...overrides,
  };
}

const at = (series: readonly { value: number | null }[] | undefined, q: Quarter) => series?.[quarters.indexOf(q)]?.value;

describe('buildRent: rent-relative-cpi', () => {
  it('reproduces rel(d) * base(c) in the base year and follows the city CPI afterwards', () => {
    const { series } = buildRent(input());
    // Taipei pooled median = (30 + 60) / 2 = 45, base(Taipei) = 30 (only T1 rents in 2024).
    // rel(T1) = 30 / 45, rel(T2) = 60 / 45. CPI 100 until 2024, 110 in 2025.
    for (const q of ['2015Q1', '2024Q1', '2024Q4'] as Quarter[]) {
      expect(at(series['T1'], q)).toBe(20);
      expect(at(series['T2'], q)).toBe(40);
    }
    expect(at(series['T1'], '2025Q1')).toBe(22);
    expect(at(series['T2'], '2025Q4')).toBe(44);
    expect(at(series['N1'], '2024Q3')).toBe(20);
  });

  it('marks every record estimated with the method id', () => {
    const { series } = buildRent(input());
    for (const rec of series['T1'] ?? []) expect(rec).toMatchObject({ estimated: true, method: RENT_CPI_METHOD });
    expect(series['T1']).toHaveLength(44);
  });

  it('averages the base year of the CPI over its four quarters', () => {
    // CPI changes within 2024: Q1 = 90, others 100 -> cpi2024 = (90 + 100 * 3) / 4 = 97.5.
    const taipei = cpiRows(100, 100).map((r) => (r.yearMonth.startsWith('2024-0') && Number(r.yearMonth.slice(5)) <= 3 ? { ...r, value: 90 } : r));
    const { series } = buildRent(input({ cpi: { Taipei: taipei, 'New Taipei': cpiRows(200, 200) } }));
    // rent(T1, 2024Q1) = 2/3 * 30 * 90 / 97.5 = 18.4615...
    expect(at(series['T1'], '2024Q1')).toBe(18.5);
    expect(at(series['T1'], '2024Q2')).toBe(20.5);
  });
});

describe('buildRent: reference districts', () => {
  it('uses the statistics ratio when both districts are in the MOI statistics', () => {
    const { series, references } = buildRent(input());
    // ratio = 7500 / 10000 = 0.75, rent(N1) = 20 -> 15.
    expect(at(series['N2'], '2024Q1')).toBe(15);
    expect(series['N2']?.[0]).toMatchObject({ estimated: true, method: RENT_STATS_METHOD });
    expect(references.find((r) => r.district === 'N2')).toMatchObject({ reference: 'N1', method: RENT_STATS_METHOD, ratio: 0.75, recordCount: 1, secondRule: false });
  });

  it('uses the sale-price ratio when the district is not in the statistics', () => {
    const { series, references } = buildRent(input());
    // ratio = 500 / 800 = 0.625 -> 12.5.
    expect(at(series['N3'], '2024Q1')).toBe(12.5);
    expect(series['N3']?.[0]).toMatchObject({ estimated: true, method: RENT_SALE_RATIO_METHOD });
    expect(references.find((r) => r.district === 'N3')?.ratio).toBe(0.625);
  });

  it('borrows the unrounded reference rent', () => {
    // N1 rent = 20.04 (p = 20.04) would round to 20; the borrowing district must use 20.04 * 0.75 = 15.03 -> 15.0.
    const odd = rentals.map((r) => (r.districtCode === 'N1' ? { ...r, rent: 200.4 } : r));
    const { series } = buildRent(input({ rentals: odd }));
    expect(at(series['N1'], '2024Q1')).toBe(20);
    expect(at(series['N2'], '2024Q1')).toBe(15);
    const big = rentals.map((r) => (r.districtCode === 'N1' ? { ...r, rent: 200.6 } : r));
    // 20.06 * 0.75 = 15.045 -> 15.0, while the rounded 20.1 * 0.75 = 15.075 would give 15.1.
    expect(at(buildRent(input({ rentals: big })).series['N2'], '2024Q1')).toBe(15);
  });

  it('prints a note for table entries whose district has enough records', () => {
    const extra = { ...table, T1: { reference: 'T2', relation: 'borders', expectedRatioMethod: 'sale-price' } as RentReferenceEntry };
    const { notes } = buildRent(input({ referenceTable: extra }));
    expect(notes.join('\n')).toContain('T1');
  });
});

describe('buildRent: errors', () => {
  it('stops with the series and month for a missing CPI month', () => {
    const err = catchError(() => buildRent(input({ cpi: { Taipei: cpiRows(100, 110), 'New Taipei': cpiRows(200, 200, '2019-05') } })));
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).message).toBe('missing-cpi-month: macro/dgbas-6019 2019-05');
  });

  it('stops when the CPI mapping does not match the required series', () => {
    const err = catchError(() => buildRent(input({ cpiMapping: { Taipei: 'macro/dgbas-6019', 'New Taipei': 'macro/dgbas-6019' } })));
    expect((err as DataError).message).toContain('cpi-series-mismatch');
    expect((err as DataError).message).toContain('T1');
  });

  it('stops when a district below 30 records has no entry', () => {
    const { N3: _removed, ...partial } = table;
    const err = catchError(() => buildRent(input({ referenceTable: partial })));
    expect((err as DataError).message).toBe('rent-reference-missing-entry: N3');
  });

  it('stops when the reference is in another city, has too few records or does not border the district', () => {
    const other = { ...table, N3: { reference: 'T1', relation: 'borders', expectedRatioMethod: 'sale-price' } as RentReferenceEntry };
    expect((catchError(() => buildRent(input({ referenceTable: other }))) as DataError).message).toBe('rent-reference-same-city: N3');
    const thin = { ...table, N3: { reference: 'N2', relation: 'borders', expectedRatioMethod: 'sale-price' } as RentReferenceEntry };
    expect((catchError(() => buildRent(input({ referenceTable: thin }))) as DataError).message).toBe('rent-reference-reference-records: N3');
    const far = new Map([['N1', ['N2']], ['N2', ['N1']], ['N3', [] as string[]]]);
    expect((catchError(() => buildRent(input({ adjacency: far }))) as DataError).message).toBe('rent-reference-border: N3');
  });

  it('stops when a sale-price ratio is needed and the sale price is missing', () => {
    const err = catchError(() => buildRent(input({ salePriceUnrounded: new Map() })));
    expect((err as DataError).message).toBe('missing-sale-price: N3');
  });
});

describe('helpers', () => {
  it('monthsOf gives the three months of a quarter', () => {
    expect(monthsOf('2024Q4')).toEqual(['2024-10', '2024-11', '2024-12']);
  });

  it('buildSalePrice also returns the unrounded values', () => {
    const sales: LvrRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      kind: 'sale' as const,
      districtCode: 'A',
      quarter: '2020Q1' as Quarter,
      target: '建物',
      use: '住家用',
      unitPrice: 100 + i + 0.25,
      totalPrice: 1,
      rent: 0,
      area: 1,
    }));
    const r = buildSalePrice(sales, [{ code: 'A' }], quarters);
    expect(r.unrounded.get('A')?.[quarters.indexOf('2020Q1')]).toBe(104.75);
    expect(r.series['A']?.[quarters.indexOf('2020Q1')]?.value).toBe(105);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}
