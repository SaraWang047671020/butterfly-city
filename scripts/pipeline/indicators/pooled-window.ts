/**
 * Shared bucketing and pooled-window median used by the sale price and median total price indicators
 * (Requirements 8.1, 8.7-8.9, 19.4). The window loop is the one that was in buildSalePrice.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import { median, roundTo } from '../numeric.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import type { CodeRef } from './series.ts';

/** District code -> one list of picked values per quarter, in input order. Records outside the districts or quarters are ignored. */
export function bucketByDistrictQuarter(
  records: readonly LvrRecord[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
  pick: (r: LvrRecord) => number,
): Map<string, number[][]> {
  const index = new Map<string, number>(quarters.map((q, i) => [q, i]));
  const buckets = new Map<string, number[][]>(districts.map((d) => [d.code, quarters.map(() => [] as number[])]));
  for (const r of records) {
    if (r.districtCode === undefined || r.quarter === undefined) continue;
    const cells = buckets.get(r.districtCode);
    const i = index.get(r.quarter);
    if (cells === undefined || i === undefined) continue;
    (cells[i] as number[]).push(pick(r));
  }
  return buckets;
}

export interface PooledWindowOptions {
  /** A cell with at least this many values uses its own median. */
  readonly minCount: number;
  readonly decimals: number;
  /** Method_Id written on pooled cells. */
  readonly method: string;
  /** DataError code when the widest window is empty. */
  readonly errorCode: string;
}

export interface PooledWindowSeries {
  readonly records: ValueRecord[];
  /** The medians before rounding. */
  readonly unrounded: number[];
  /** Window radius -> number of quarters. Radius 0 is the district's own median. */
  readonly radiusCounts: Map<number, number>;
}

/** The window loop of buildSalePrice, for one district's cells (one list per quarter). */
export function pooledWindowSeries(
  cells: readonly (readonly number[])[],
  quarters: readonly Quarter[],
  districtCode: string,
  options: PooledWindowOptions,
): PooledWindowSeries {
  const { minCount, decimals, method, errorCode } = options;
  const last = quarters.length - 1;
  const radiusCounts = new Map<number, number>();
  const records: ValueRecord[] = [];
  const unrounded: number[] = [];
  for (let i = 0; i <= last; i++) {
    const own = cells[i] as readonly number[];
    let radius = 0;
    let pooled: readonly number[] = own;
    if (own.length < minCount) {
      let lo = i;
      let hi = i;
      do {
        radius++;
        lo = Math.max(0, i - radius);
        hi = Math.min(last, i + radius);
        pooled = cells.slice(lo, hi + 1).flat();
      } while (pooled.length < minCount && !(lo === 0 && hi === last));
      if (pooled.length === 0) {
        throw new DataError(errorCode, `district ${districtCode} ${quarters[i] as string}`, [
          `no qualifying sales in ${quarters[lo] as string}..${quarters[hi] as string}, the widest window`,
        ]);
      }
    }
    radiusCounts.set(radius, (radiusCounts.get(radius) ?? 0) + 1);
    const exact = median(pooled as number[]);
    unrounded.push(exact);
    const value = roundTo(exact, decimals);
    records.push(radius === 0 ? { value, estimated: false } : { value, estimated: true, method });
  }
  return { records, unrounded, radiusCounts };
}
