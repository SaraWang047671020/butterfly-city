import { describe, expect, it } from 'vitest';
import { formatNumber } from '../../src/ui/format/number.ts';
import { formatRange } from '../../src/ui/format/range.ts';
import { formatDifference } from '../../src/ui/format/difference.ts';

const M = '\u2212';

describe('formatNumber', () => {
  it('groups thousands and fixes decimals', () => {
    expect(formatNumber(1234567.891, 1)).toBe('1,234,567.9');
    expect(formatNumber(5, 2)).toBe('5.00');
  });
  it('uses U+2212 for negatives', () => {
    expect(formatNumber(-1.25, 1)).toBe(`${M}1.3`);
  });
  it('never produces a negative zero', () => {
    expect(formatNumber(-0, 1)).toBe('0.0');
    expect(formatNumber(-0.04, 1)).toBe('0.0');
  });
  it('gives "no value" for null and non-finite, never 0', () => {
    expect(formatNumber(null, 1)).toBe('no value');
    expect(formatNumber(NaN, 1)).toBe('no value');
    expect(formatNumber(Infinity, 0)).toBe('no value');
  });
});

describe('formatRange', () => {
  it('shows a range when three values differ', () => {
    const r = formatRange({ min: 10.2, central: 12.5, max: 15.1 }, 1, 'TWD');
    expect(r.kind).toBe('range');
    expect(r.text).toBe('12.5 TWD (possible range 10.2–15.1 TWD)');
  });
  it('shows "same" when the three values are equal after formatting', () => {
    const r = formatRange({ min: 12.01, central: 12.0, max: 11.99 }, 1, 'TWD');
    expect(r).toEqual({ kind: 'same', value: '12.0', text: '12.0 TWD, same in all scenarios' });
  });
  it('shows a range when values differ only before formatting but not after for some', () => {
    const r = formatRange({ min: 11.9, central: 12.0, max: 12.0 }, 1, 'TWD');
    expect(r.kind).toBe('range');
  });
  it('decides sameness on formatted strings, not raw numbers', () => {
    expect(formatRange({ min: 1.001, central: 1.002, max: 1.003 }, 1, 'x').kind).toBe('same');
    expect(formatRange({ min: 1.001, central: 1.002, max: 1.003 }, 3, 'x').kind).toBe('range');
  });
  it('returns "no value" for null or non-finite ranges', () => {
    expect(formatRange(null, 1, 'x')).toEqual({ kind: 'none', text: 'no value' });
    expect(formatRange({ min: 1, central: NaN, max: 2 }, 1, 'x').kind).toBe('none');
  });
});

describe('formatDifference', () => {
  it('prefixes + for positive differences', () => {
    expect(formatDifference(5, 3.5, 1, 'TWD')).toBe('+1.5 TWD');
  });
  it('uses U+2212 for negative differences', () => {
    expect(formatDifference(3.5, 5, 1, 'TWD')).toBe(`${M}1.5 TWD`);
  });
  it('shows zero without a sign, including when it rounds to zero', () => {
    expect(formatDifference(5, 5, 1, 'TWD')).toBe('0.0 TWD');
    expect(formatDifference(5, 5.04, 1, 'TWD')).toBe('0.0 TWD');
    expect(formatDifference(5.04, 5, 1, 'TWD')).toBe('0.0 TWD');
  });
  it('supports percentage points as unit', () => {
    expect(formatDifference(30, 25, 1, 'percentage points')).toBe('+5.0 percentage points');
  });
  it('gives "no value" when an input is null, never 0', () => {
    expect(formatDifference(null, 1, 1, 'TWD')).toBe('no value');
    expect(formatDifference(1, null, 1, 'TWD')).toBe('no value');
  });
});
