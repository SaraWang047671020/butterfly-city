/**
 * Sale price indicator (Requirement 8).
 *
 *   n(d, q)         = qualifying sales in district d with transaction quarter q
 *   salePrice(d, q) = median unit price of those sales                       if n(d, q) >= 10
 *                   = median unit price over the window W_r(q), estimated    otherwise
 *   W_r(q)          = quarters q-r .. q+r clipped to 2015Q1..2025Q4
 *   r               = smallest r >= 1 with count(W_r) >= 10, or the r at which W_r covers all quarters
 *
 * There is no cap on r. A final window with zero sales stops the build with the district and quarter
 * (Requirement 8.9); no fallback value exists. Radius 0 in the window counts means "own median".
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import { median, roundTo } from '../numeric.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import { INDICATOR_SPECS } from '../registry/indicators.ts';
import type { Step } from '../run.ts';
import { exclusionNotes, loadLvr } from './lvr-input.ts';
import type { CodeRef, DistrictSeries } from './series.ts';

/** A district-quarter with at least this many qualifying sales uses its own median. */
export const SALE_MIN_COUNT = 10;
export const SALE_POOLED_METHOD = 'sale-price-pooled-window';

export interface SalePriceResult {
  readonly series: DistrictSeries;
  /** District code -> window radius -> number of quarters. Radius 0 is the district's own median. */
  readonly windowCounts: Map<string, Map<number, number>>;
  /** District code -> the 44 values before rounding (used by the rent reference ratio, Requirement 9.5). */
  readonly unrounded: Map<string, number[]>;
}

function saleDecimals(): number {
  const spec = INDICATOR_SPECS.find((s) => s.id === 'salePrice');
  if (spec === undefined) throw new Error('indicator spec not found: salePrice');
  return spec.decimals;
}

/**
 * Builds the sale price series. `sales` must already be qualifying sales (filter applied, de-duplicated).
 * Records whose quarter is not in `quarters` are ignored.
 */
export function buildSalePrice(
  sales: readonly LvrRecord[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): SalePriceResult {
  const decimals = saleDecimals();
  const index = new Map<string, number>(quarters.map((q, i) => [q, i]));
  const last = quarters.length - 1;

  const prices = new Map<string, number[][]>(districts.map((d) => [d.code, quarters.map(() => [] as number[])]));
  for (const r of sales) {
    if (r.districtCode === undefined || r.quarter === undefined) continue;
    const cells = prices.get(r.districtCode);
    const i = index.get(r.quarter);
    if (cells === undefined || i === undefined) continue;
    (cells[i] as number[]).push(r.unitPrice);
  }

  const series: DistrictSeries = {};
  const windowCounts = new Map<string, Map<number, number>>();
  const unrounded = new Map<string, number[]>();
  for (const d of districts) {
    const cells = prices.get(d.code) as number[][];
    const counts = new Map<number, number>();
    const records: ValueRecord[] = [];
    const raw: number[] = [];
    unrounded.set(d.code, raw);
    for (let i = 0; i <= last; i++) {
      const own = cells[i] as number[];
      let radius = 0;
      let pooled: number[] = own;
      if (own.length < SALE_MIN_COUNT) {
        let lo = i;
        let hi = i;
        do {
          radius++;
          lo = Math.max(0, i - radius);
          hi = Math.min(last, i + radius);
          pooled = cells.slice(lo, hi + 1).flat();
        } while (pooled.length < SALE_MIN_COUNT && !(lo === 0 && hi === last));
        if (pooled.length === 0) {
          throw new DataError('no-sales-for-sale-price', `district ${d.code} ${quarters[i] as string}`, [
            `no qualifying sales in ${quarters[lo] as string}..${quarters[hi] as string}, the widest window`,
          ]);
        }
      }
      counts.set(radius, (counts.get(radius) ?? 0) + 1);
      const exact = median(pooled);
      raw.push(exact);
      const value = roundTo(exact, decimals);
      records.push(radius === 0 ? { value, estimated: false } : { value, estimated: true, method: SALE_POOLED_METHOD });
    }
    series[d.code] = records;
    windowCounts.set(d.code, counts);
  }
  return { series, windowCounts, unrounded };
}

export function salePriceStep(): Step {
  return {
    name: 'sale-price',
    run(ctx, state) {
      const load = (state.lvrSales ??= loadLvr(ctx, 'sale'));
      const built = buildSalePrice(load.qualifying, ctx.districts, ctx.quarters);
      state.salePrice = built.series;
      state.salePriceWindowCounts = built.windowCounts;
      state.salePriceUnrounded = built.unrounded;
      state.notes.push(...exclusionNotes('sale', load.exclusions));
    },
  };
}
