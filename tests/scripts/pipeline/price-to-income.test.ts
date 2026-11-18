import { describe, expect, it } from 'vitest';
import type { City } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  buildPriceToIncome,
  cityTotalPrices,
  comparePriceToIncome,
  parseMoiPriceToIncome,
  PRICE_TO_INCOME_METHOD,
  skippedNote,
} from '../../../scripts/pipeline/indicators/price-to-income.ts';
import { totalPriceSales } from '../../../scripts/pipeline/indicators/lvr-input.ts';
import type { CitySeries } from '../../../scripts/pipeline/indicators/series.ts';
import type { LvrRecord } from '../../../scripts/pipeline/parsers/lvr.ts';

const quarters = quartersBetween();
const districts = [
  { code: 'A', city: 'Taipei' as const },
  { code: 'B', city: 'New Taipei' as const },
];

function sale(code: string, quarter: Quarter, totalPrice: number): LvrRecord {
  return {
    id: '',
    kind: 'sale',
    districtCode: code,
    quarter,
    target: '房地(土地+建物)',
    use: '住家用',
    unitPrice: 100,
    totalPrice,
    rent: 0,
    area: 50,
  };
}

/** 100 sales per city-quarter at the given total price. */
function baseSales(price: number): LvrRecord[] {
  const out: LvrRecord[] = [];
  for (const q of quarters) for (const code of ['A', 'B']) for (let i = 0; i < 100; i++) out.push(sale(code, q, price));
  return out;
}

function income(taipei: number, newTaipei: number): Map<City, Map<Quarter, number>> {
  return new Map<City, Map<Quarter, number>>([
    ['Taipei', new Map(quarters.map((q) => [q, taipei]))],
    ['New Taipei', new Map(quarters.map((q) => [q, newTaipei]))],
  ]);
}

describe('buildPriceToIncome', () => {
  it('divides the city median total price by the unrounded city income and rounds to 2 decimals', () => {
    // 2020Q1 Taipei: 50 sales at 10M and 50 at 20M -> median 15M, income 1.2M -> 12.5.
    const sales = [...baseSales(20_000_000).filter((r) => !(r.districtCode === 'A' && r.quarter === '2020Q1'))];
    for (let i = 0; i < 50; i++) sales.push(sale('A', '2020Q1', 10_000_000), sale('A', '2020Q1', 20_000_000));
    const incomeMap = income(3_000_000, 4_000_000);
    (incomeMap.get('Taipei') as Map<Quarter, number>).set('2020Q1', 1_200_000);
    const r = buildPriceToIncome(sales, incomeMap, districts, quarters);
    const i = quarters.indexOf('2020Q1');
    expect(r.Taipei[i]).toEqual({ value: 12.5, estimated: true, method: PRICE_TO_INCOME_METHOD });
    expect(r.Taipei[0]?.value).toBe(6.67); // 20M / 3M = 6.666...
    expect(r['New Taipei'][0]?.value).toBe(5); // 20M / 4M
    expect(r.Taipei).toHaveLength(44);
    expect(r['New Taipei']).toHaveLength(44);
  });

  it('ignores sales with a zero total price', () => {
    const sales = [...baseSales(20_000_000)];
    for (let i = 0; i < 300; i++) sales.push(sale('A', '2020Q1', 0));
    const r = buildPriceToIncome(sales, income(4_000_000, 4_000_000), districts, quarters);
    expect(r.Taipei[quarters.indexOf('2020Q1')]?.value).toBe(5);
  });

  it('stops with the city, quarter and count when a city-quarter has fewer than 100 qualifying sales', () => {
    const sales = baseSales(20_000_000).filter((r) => !(r.districtCode === 'B' && r.quarter === '2020Q1'));
    for (let i = 0; i < 99; i++) sales.push(sale('B', '2020Q1', 20_000_000));
    for (let i = 0; i < 5; i++) sales.push(sale('B', '2020Q1', 0)); // does not count
    let error: unknown;
    try {
      buildPriceToIncome(sales, income(1_000_000, 1_000_000), districts, quarters);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).subject).toBe('New Taipei 2020Q1');
    expect((error as DataError).details[0]).toContain('99');
  });

  it('stops when the city income has no value for a quarter', () => {
    const incomeMap = income(1_000_000, 1_000_000);
    (incomeMap.get('Taipei') as Map<Quarter, number>).delete('2018Q2');
    let error: unknown;
    try {
      buildPriceToIncome(baseSales(20_000_000), incomeMap, districts, quarters);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).subject).toBe('Taipei 2018Q2');
  });
});

describe('totalPriceSales', () => {
  it('drops total price 0, negative and NaN, and records without district or quarter; keeps input order', () => {
    const noDistrict: LvrRecord = { ...sale('A', '2020Q1', 5), districtCode: undefined };
    const noQuarter: LvrRecord = { ...sale('A', '2020Q1', 5), quarter: undefined };
    const keep1 = sale('B', '2020Q2', 30);
    const keep2 = sale('A', '2020Q1', 10);
    const out = totalPriceSales([
      keep1,
      sale('A', '2020Q1', 0),
      sale('A', '2020Q1', -4),
      sale('A', '2020Q1', Number.NaN),
      noDistrict,
      noQuarter,
      keep2,
    ]);
    expect(out).toEqual([keep1, keep2]);
  });
});

describe('cityTotalPrices', () => {
  it('groups total prices by city and quarter in input order and skips unknown districts and zero prices', () => {
    const out = cityTotalPrices(
      [
        sale('A', '2020Q1', 3),
        sale('B', '2020Q1', 7),
        sale('A', '2020Q2', 4),
        sale('A', '2020Q1', 1),
        sale('A', '2020Q1', 0),
        sale('Z', '2020Q1', 9),
      ],
      districts,
      quarters,
    );
    expect([...out.keys()].sort()).toEqual(['New Taipei|2020Q1', 'Taipei|2020Q1', 'Taipei|2020Q2']);
    expect(out.get('Taipei|2020Q1')).toEqual([3, 1]);
    expect(out.get('New Taipei|2020Q1')).toEqual([7]);
    expect(out.get('Taipei|2020Q2')).toEqual([4]);
  });
});

describe('buildPriceToIncome with a zero total price record', () => {
  it('leaves the literal expected series unchanged', () => {
    const sales = [...baseSales(20_000_000), sale('A', '2020Q1', 0), sale('B', '2020Q1', 0)];
    const r = buildPriceToIncome(sales, income(4_000_000, 5_000_000), districts, quarters);
    expect(r.Taipei.every((rec) => rec.value === 5)).toBe(true);
    expect(r['New Taipei'].every((rec) => rec.value === 4)).toBe(true);
    expect(r.Taipei[quarters.indexOf('2020Q1')]).toEqual({ value: 5, estimated: true, method: PRICE_TO_INCOME_METHOD });
  });
});

describe('parseMoiPriceToIncome', () => {
  const header = 'city,quarter,ratio,source_pdf\n';
  const parse = (body: string) => parseMoiPriceToIncome(header + body, 'data/config/moi-price-to-income.csv');

  it('parses valid rows', () => {
    expect(parse('Taipei,2016Q3,14.6,a.pdf\nNew Taipei,2025Q4,12.1,b.pdf\n')).toEqual([
      { city: 'Taipei', quarter: '2016Q3', ratio: 14.6, sourcePdf: 'a.pdf' },
      { city: 'New Taipei', quarter: '2025Q4', ratio: 12.1, sourcePdf: 'b.pdf' },
    ]);
  });

  it.each([
    ['unknown city', 'Kaohsiung,2017Q1,9,a.pdf\n', 'city'],
    ['quarter before range', 'Taipei,2016Q2,9,a.pdf\n', 'quarter'],
    ['quarter after range', 'Taipei,2026Q1,9,a.pdf\n', 'quarter'],
    ['malformed quarter', 'Taipei,2017-1,9,a.pdf\n', 'quarter'],
    ['zero ratio', 'Taipei,2017Q1,0,a.pdf\n', 'ratio'],
    ['negative ratio', 'Taipei,2017Q1,-3,a.pdf\n', 'ratio'],
    ['non-numeric ratio', 'Taipei,2017Q1,abc,a.pdf\n', 'ratio'],
  ])('rejects %s with the row number', (_name, body, word) => {
    let error: unknown;
    try {
      parse(`Taipei,2017Q2,9,a.pdf\n${body}`);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).row).toBe(3);
    expect((error as ParseError).message).toContain(word);
  });

  it('rejects a repeated city and quarter', () => {
    let error: unknown;
    try {
      parse('Taipei,2017Q1,9,a.pdf\nNew Taipei,2017Q1,8,a.pdf\nTaipei,2017Q1,9.5,b.pdf\n');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).row).toBe(4);
    expect((error as ParseError).message).toContain('duplicate');
  });

  it('rejects a missing column', () => {
    expect(() => parseMoiPriceToIncome('city,quarter,ratio\nTaipei,2017Q1,9\n', 'f.csv')).toThrow(ParseError);
  });
});

describe('comparePriceToIncome', () => {
  const rec = (value: number) => ({ value, estimated: true as const, method: PRICE_TO_INCOME_METHOD });
  const computed: CitySeries = {
    Taipei: quarters.map(() => rec(10)),
    'New Taipei': quarters.map(() => rec(8)),
  };
  computed.Taipei[quarters.indexOf('2017Q1')] = rec(12.34);
  computed.Taipei[quarters.indexOf('2017Q2')] = rec(9.5);

  it('prints one line per row and the largest absolute difference per city', () => {
    const lines = comparePriceToIncome(
      computed,
      [
        { city: 'Taipei', quarter: '2017Q1', ratio: 12, sourcePdf: 'a.pdf' }, // +0.34
        { city: 'Taipei', quarter: '2017Q2', ratio: 10.2, sourcePdf: 'b.pdf' }, // -0.70
        { city: 'New Taipei', quarter: '2017Q1', ratio: 8, sourcePdf: 'a.pdf' }, // 0.00
      ],
      quarters,
    );
    expect(lines).toEqual([
      'price-to-income Taipei 2017Q1: computed 12.34, MOI 12.00, difference +0.34 (a.pdf)',
      'price-to-income Taipei 2017Q2: computed 9.50, MOI 10.20, difference -0.70 (b.pdf)',
      'price-to-income New Taipei 2017Q1: computed 8.00, MOI 8.00, difference 0.00 (a.pdf)',
      'price-to-income Taipei: largest absolute difference -0.70 at 2017Q2',
      'price-to-income New Taipei: largest absolute difference 0.00 at 2017Q1',
    ]);
  });

  it('does not modify the computed series', () => {
    const before = JSON.stringify(computed);
    comparePriceToIncome(computed, [{ city: 'Taipei', quarter: '2017Q1', ratio: 1, sourcePdf: 'a.pdf' }], quarters);
    expect(JSON.stringify(computed)).toBe(before);
  });

  it('has a fixed skipped note for an absent table', () => {
    expect(skippedNote()).toBe('price-to-income validation skipped: data/config/moi-price-to-income.csv not found');
  });
});
