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
import type { Quarter } from '../../lib/time.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import { INDICATOR_SPECS } from '../registry/indicators.ts';
import type { Step } from '../run.ts';
import { exclusionNotes, loadLvr } from './lvr-input.ts';
import { bucketByDistrictQuarter, pooledWindowSeries } from './pooled-window.ts';
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
  const options = { minCount: SALE_MIN_COUNT, decimals: saleDecimals(), method: SALE_POOLED_METHOD, errorCode: 'no-sales-for-sale-price' };
  const buckets = bucketByDistrictQuarter(sales, districts, quarters, (r) => r.unitPrice);
  const series: DistrictSeries = {};
  const windowCounts = new Map<string, Map<number, number>>();
  const unrounded = new Map<string, number[]>();
  for (const d of districts) {
    const built = pooledWindowSeries(buckets.get(d.code) as number[][], quarters, d.code, options);
    series[d.code] = built.records;
    windowCounts.set(d.code, built.radiusCounts);
    unrounded.set(d.code, built.unrounded);
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
