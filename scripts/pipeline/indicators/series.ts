/** Shared helpers of the district indicator builders (pure). */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';

/** One series of 44 records (quarter order) per district code. */
export type DistrictSeries = Record<string, ValueRecord[]>;

/** One series of 44 records (quarter order) per city. */
export type CitySeries = Record<'Taipei' | 'New Taipei', ValueRecord[]>;

/** Anything with a district code; `DistrictRef` satisfies it. */
export interface CodeRef {
  readonly code: string;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** ROC `yyymm` key of an AD year and month, e.g. (2015, 1) -> "10401". */
export function rocMonthKey(year: number, month: number): string {
  return `${year - 1911}${pad2(month)}`;
}

/** The three ROC `yyymm` keys of a quarter, in calendar order. */
export function quarterMonths(quarter: Quarter): [string, string, string] {
  const year = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(5));
  return [rocMonthKey(year, q * 3 - 2), rocMonthKey(year, q * 3 - 1), rocMonthKey(year, q * 3)];
}

/** Throws DataError unless `value` is a non-negative safe integer. */
export function checkCount(value: number, rule: string, subject: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DataError(rule, subject, [`value: ${String(value)} (expected a non-negative integer)`]);
  }
  return value;
}
