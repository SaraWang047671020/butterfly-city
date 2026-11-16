import { describe, expect, it } from 'vitest';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { HouseTaxRow } from '../../../scripts/pipeline/parsers/house-tax.ts';
import type { HoldingTaxCity, HoldingTaxRateRow } from '../../../scripts/pipeline/parsers/policy-tables.ts';
import { buildHoldingTaxRates, buildHouseTaxRevenue } from '../../../scripts/pipeline/policy/holding-tax.ts';

let n = 1;
function rate(city: HoldingTaxCity, effectiveDate: string, lowestRate: number, highestRate: number, source: string): HoldingTaxRateRow {
  return { row: n++, city, effectiveDate, lowestRate, highestRate, legalText: 'text', articleOrVersion: 'Art.', source, url: '' };
}

const rows: HoldingTaxRateRow[] = [
  rate('statutory', '2014-06-06', 1.5, 3.6, 'policy/house-tax-act'),
  rate('statutory', '2024-07-01', 2.0, 4.8, 'policy/house-tax-act'),
  rate('Taipei', '2014-07-01', 2.4, 3.6, 'policy/taipei-ordinance'),
  rate('Taipei', '2024-07-01', 3.2, 4.8, 'policy/taipei-ordinance'),
  rate('New Taipei', '2017-07-01', 2.4, 2.4, 'policy/ntpc-ordinance'),
];
const quarters: Quarter[] = ['2017Q2', '2017Q3', '2024Q2', '2024Q3'];

describe('buildHoldingTaxRates', () => {
  const { lowest, highest } = buildHoldingTaxRates(rows, quarters);

  it('takes the city row with the latest effective date on or before the last day of the quarter, observed', () => {
    expect(lowest.Taipei.map((r) => r.value)).toEqual([2.4, 2.4, 2.4, 3.2]); // 2024Q3 ends after 2024-07-01
    expect(highest.Taipei.map((r) => r.value)).toEqual([3.6, 3.6, 3.6, 4.8]);
    expect(lowest.Taipei[3]).toEqual({ value: 3.2, source: 'policy/taipei-ordinance', estimated: false });
    expect(lowest['New Taipei'][1]).toEqual({ value: 2.4, source: 'policy/ntpc-ordinance', estimated: false });
    expect(highest['New Taipei'].slice(1).map((r) => r.value)).toEqual([2.4, 2.4, 2.4]);
  });

  it('uses the statutory minimum for both rates, estimated, where the city has no row', () => {
    const expected = { value: 1.5, source: 'policy/house-tax-act', estimated: true, method: 'holding-tax-statutory-minimum' };
    expect(lowest['New Taipei'][0]).toEqual(expected);
    expect(highest['New Taipei'][0]).toEqual(expected); // the lowest limit, not the highest (3.6)
  });

  it('uses the statutory row in force on that day', () => {
    const q: Quarter[] = ['2024Q2', '2024Q3'];
    const noCity = rows.filter((r) => r.city === 'statutory');
    const r = buildHoldingTaxRates(noCity, q).lowest;
    expect(r.Taipei.map((x) => x.value)).toEqual([1.5, 2.0]);
  });

  it('stops naming the series, city and quarter when no row is in force', () => {
    const early: Quarter[] = ['2014Q1'];
    expect(() => buildHoldingTaxRates(rows, early)).toThrow(DataError);
    expect(() => buildHoldingTaxRates(rows, early)).toThrow('holdingTaxRateLowestTier Taipei 2014Q1');
  });
});

describe('buildHouseTaxRevenue', () => {
  const taxRows: HouseTaxRow[] = [
    { city: 'Taipei', year: 2017, amountThousand: 1001.5 },
    { city: 'New Taipei', year: 2017, amountThousand: 400 },
  ];
  const year: Quarter[] = ['2017Q1', '2017Q2', '2017Q3', '2017Q4'];

  it('rounds the annual amount to an integer and splits it into four whole quarters that sum to it', () => {
    const t = buildHouseTaxRevenue(taxRows, year);
    // round(1001.5) = 1002 = 250.5 · 4: the two extra units go to the first two quarters.
    expect(t.Taipei.map((r) => r.value)).toEqual([251, 251, 250, 250]);
    expect(t['New Taipei'].map((r) => r.value)).toEqual([100, 100, 100, 100]);
  });

  it('marks every record estimated with the even-split method and the MOF source', () => {
    const t = buildHouseTaxRevenue(taxRows, year);
    for (const r of t.Taipei) expect(r).toMatchObject({ source: 'policy/mof-6742', estimated: true, method: 'house-tax-even-split' });
  });

  it('stops naming the series, city and quarter when a year has no figure', () => {
    expect(() => buildHouseTaxRevenue(taxRows, ['2018Q1'])).toThrow('houseTaxRevenue Taipei 2018Q1');
  });
});
