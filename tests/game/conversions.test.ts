// Price_To_Income unit tests (Requirements 19.8, 3.5, 3.6, 3.14).
import { describe, expect, it } from 'vitest';
import { priceToIncome } from '../../src/game/core/conversions.ts';
import type { HistoryFile, ValueRecord } from '../../src/types/data-files.ts';

const CODE = '63000010';
const OBSERVED = (value: number): ValueRecord => ({ value, estimated: false });
const ESTIMATED = (value: number | null, method: string): ValueRecord =>
  ({ value, estimated: true, method }) as ValueRecord;

function makeHistory(price: ValueRecord | null, income: ValueRecord | null): HistoryFile {
  const indicators: unknown[] = [];
  if (price !== null) indicators.push({ id: 'medianTotalPrice', level: 'district', series: { [CODE]: [price, price] } });
  if (income !== null) indicators.push({ id: 'householdIncome', level: 'district', series: { [CODE]: [income, income] } });
  return { quarters: ['2015Q1', '2015Q2'], indicators } as unknown as HistoryFile;
}

describe('priceToIncome', () => {
  it('computes 10,000,000 / 1,400,000 = 7.14, flagged estimated', () => {
    const result = priceToIncome(makeHistory(OBSERVED(10_000_000), OBSERVED(1_400_000)), CODE, '2015Q2');
    expect(result).toEqual({ value: 7.14, estimated: true, methodIds: [] });
  });

  it('rounds half up to 2 decimals', () => {
    // 1,250,000 / 1,000,000 = 1.25 exactly; 3,125 / 1,000 = 3.125 -> 3.13
    expect(priceToIncome(makeHistory(OBSERVED(3125), OBSERVED(1000)), CODE, '2015Q1').value).toBe(3.13);
  });

  it('returns null for a missing price indicator', () => {
    expect(priceToIncome(makeHistory(null, OBSERVED(1_400_000)), CODE, '2015Q1')).toEqual({
      value: null,
      estimated: false,
      methodIds: [],
    });
  });

  it('returns null for a null price value', () => {
    const result = priceToIncome(makeHistory({ value: null, estimated: false }, OBSERVED(1_400_000)), CODE, '2015Q1');
    expect(result.value).toBeNull();
  });

  it('returns null for a zero, null or missing householdIncome', () => {
    expect(priceToIncome(makeHistory(OBSERVED(10_000_000), OBSERVED(0)), CODE, '2015Q1').value).toBeNull();
    expect(priceToIncome(makeHistory(OBSERVED(10_000_000), ESTIMATED(null, 'inc-m')), CODE, '2015Q1').value).toBeNull();
    expect(priceToIncome(makeHistory(OBSERVED(10_000_000), null), CODE, '2015Q1').value).toBeNull();
  });

  it('returns null for an unknown district or quarter', () => {
    const history = makeHistory(OBSERVED(10_000_000), OBSERVED(1_400_000));
    expect(priceToIncome(history, '99999999', '2015Q1').value).toBeNull();
    expect(priceToIncome(history, CODE, '2020Q1').value).toBeNull();
  });

  it('lists the income method id first, then the price method id, when both are estimated', () => {
    const result = priceToIncome(makeHistory(ESTIMATED(5_000_000, 'price-m'), ESTIMATED(1_000_000, 'income-m')), CODE, '2015Q1');
    expect(result).toEqual({ value: 5, estimated: true, methodIds: ['income-m', 'price-m'] });
  });

  it('lists only the income method id when only income is estimated', () => {
    const result = priceToIncome(makeHistory(OBSERVED(5_000_000), ESTIMATED(1_000_000, 'income-m')), CODE, '2015Q1');
    expect(result.methodIds).toEqual(['income-m']);
    expect(result.estimated).toBe(true);
  });

  it('lists a shared method id once', () => {
    const result = priceToIncome(makeHistory(ESTIMATED(5_000_000, 'same'), ESTIMATED(1_000_000, 'same')), CODE, '2015Q1');
    expect(result.methodIds).toEqual(['same']);
  });
});
