import type { QuarterKey } from '../types/data-files.ts';

const FIRST_YEAR = 2015;
const QUARTER_PATTERN = /^(\d{4})Q([1-4])$/;

/** Returns the key when `s` has the form `YYYYQn` with n in 1 to 4, otherwise null. */
export function parseQuarter(s: string): QuarterKey | null {
  return QUARTER_PATTERN.test(s) ? (s as QuarterKey) : null;
}

function parts(q: QuarterKey): { year: number; quarter: number } {
  const m = QUARTER_PATTERN.exec(q);
  if (m === null) {
    throw new RangeError(`Invalid quarter key: ${String(q)}`);
  }
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

/** 2015Q1 is 0. Works for any integer index, including negative values and values above 43. */
export function quarterIndex(q: QuarterKey): number {
  const { year, quarter } = parts(q);
  return (year - FIRST_YEAR) * 4 + (quarter - 1);
}

/** Inverse of `quarterIndex`. */
export function quarterAt(i: number): QuarterKey {
  const year = FIRST_YEAR + Math.floor(i / 4);
  const quarter = i - Math.floor(i / 4) * 4 + 1;
  return `${year}Q${quarter as 1 | 2 | 3 | 4}`;
}

export function nextQuarter(q: QuarterKey): QuarterKey {
  return quarterAt(quarterIndex(q) + 1);
}

export function quarterYear(q: QuarterKey): number {
  return parts(q).year;
}
