import { describe, expect, it } from 'vitest';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { E3010Row, RentAmountRow } from '../../../scripts/pipeline/parsers/rent-subsidy.ts';
import {
  buildRentSubsidyAmount,
  buildRentSubsidyHouseholds,
  rentAmountBase,
} from '../../../scripts/pipeline/policy/rent-subsidy.ts';

const quarters: Quarter[] = ['2022Q4', '2023Q1', '2023Q4', '2024Q1'];

const rows613: E3010Row[] = [
  { city: 'Taipei', quarter: '2022Q4', value: 10 },
  { city: 'Taipei', quarter: '2023Q1', value: 20 },
];
const rows631: E3010Row[] = [
  { city: 'Taipei', quarter: '2023Q1', value: 5 },
  { city: 'New Taipei', quarter: '2022Q4', value: 7 },
];

describe('buildRentSubsidyHouseholds', () => {
  it('adds both tables per city and quarter, counting a missing figure as 0', () => {
    const t = buildRentSubsidyHouseholds(rows613, rows631, quarters);
    expect(t.Taipei.map((r) => r.value)).toEqual([10, 25, 0, 0]);
    expect(t['New Taipei'].map((r) => r.value)).toEqual([7, 0, 0, 0]);
  });

  it('records are observed with the MOI E3010 source', () => {
    const t = buildRentSubsidyHouseholds(rows613, rows631, quarters);
    for (const r of [...t.Taipei, ...t['New Taipei']]) expect(r).toEqual({ value: r.value, source: 'policy/moi-e3010', estimated: false });
  });

  it('stops on a repeated city and quarter within one table', () => {
    const dup: E3010Row[] = [...rows613, { city: 'Taipei', quarter: '2023Q1', value: 1 }];
    expect(() => buildRentSubsidyHouseholds(dup, [], quarters)).toThrow(/rentSubsidyHouseholds Taipei 2023Q1/);
  });
});

const amountRows: RentAmountRow[] = [
  { city: 'Taipei', year: 2022, householdMonths: 1, amountThousand: 1 },
  { city: 'Taipei', year: 2023, householdMonths: 2000, amountThousand: 9398 }, // 9,398,000 / 2,000 = 4,699
  { city: 'New Taipei', year: 2023, householdMonths: 6000, amountThousand: 21_888 }, // 21,888,000 / 6,000 = 3,648
];

describe('buildRentSubsidyAmount', () => {
  const t = buildRentSubsidyAmount(amountRows, quarters);

  it('uses the 2023 amount per household-month for every quarter', () => {
    expect(t.Taipei.map((r) => r.value)).toEqual([4699, 4699, 4699, 4699]);
    expect(t['New Taipei'].map((r) => r.value)).toEqual([3648, 3648, 3648, 3648]);
  });

  it('marks 2023 quarters with the annual-average method and all others with the carry method, all estimated', () => {
    expect(t.Taipei.map((r) => (r.estimated ? r.method : 'observed'))).toEqual([
      'rent-amount-carry',
      'rent-amount-annual-average',
      'rent-amount-annual-average',
      'rent-amount-carry',
    ]);
    for (const r of [...t.Taipei, ...t['New Taipei']]) expect(r).toMatchObject({ source: 'policy/moi-169800', estimated: true });
  });

  it('accepts the guard limits 1,000 and 10,000', () => {
    const edge: RentAmountRow[] = [
      { city: 'Taipei', year: 2023, householdMonths: 1000, amountThousand: 1000 },
      { city: 'New Taipei', year: 2023, householdMonths: 1000, amountThousand: 10_000 },
    ];
    expect(rentAmountBase(edge)).toEqual({ Taipei: 1000, 'New Taipei': 10_000 });
  });

  it('stops on a unit error, naming the series, city and quarter', () => {
    const wrongUnit: RentAmountRow[] = [
      { city: 'Taipei', year: 2023, householdMonths: 2000, amountThousand: 9_398_000 }, // NT$ instead of NT$ thousand
      amountRows[2]!,
    ];
    expect(() => buildRentSubsidyAmount(wrongUnit, quarters)).toThrow(DataError);
    expect(() => buildRentSubsidyAmount(wrongUnit, quarters)).toThrow('rentSubsidyAmountPerHousehold Taipei 2023Q1');
    const tooLow: RentAmountRow[] = [amountRows[1]!, { city: 'New Taipei', year: 2023, householdMonths: 6000, amountThousand: 5000 }];
    expect(() => buildRentSubsidyAmount(tooLow, quarters)).toThrow(/amount-out-of-range: rentSubsidyAmountPerHousehold New Taipei 2023Q1/);
  });

  it('stops when a city has no 2023 row or no household-months', () => {
    expect(() => buildRentSubsidyAmount(amountRows.slice(0, 2), quarters)).toThrow(/missing-row: rentSubsidyAmountPerHousehold New Taipei 2023Q1/);
    const zero: RentAmountRow[] = [{ ...amountRows[1]!, householdMonths: 0 }, amountRows[2]!];
    expect(() => buildRentSubsidyAmount(zero, quarters)).toThrow(/Taipei 2023Q1/);
  });
});
