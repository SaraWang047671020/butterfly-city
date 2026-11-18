/**
 * Median total price indicator (Requirement 19).
 *
 * Same pooled-window rule as the sale price, applied to 總價元. The window is decided by m(d, q), the count of
 * sales with a total price greater than 0, not by the sale price count n(d, q). No district price-to-income
 * value is computed here (Requirement 10.1 divides in the game UI).
 */
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import { INDICATOR_SPECS } from '../registry/indicators.ts';
import type { Step } from '../run.ts';
import { loadLvr, totalPriceSales } from './lvr-input.ts';
import { bucketByDistrictQuarter, pooledWindowSeries } from './pooled-window.ts';
import { SALE_MIN_COUNT } from './sale-price.ts';
import type { CodeRef, DistrictSeries } from './series.ts';

export const TOTAL_PRICE_POOLED_METHOD = 'median-total-price-pooled-window';

const ERROR_CODE = 'no-sales-for-median-total-price';

export interface MedianTotalPriceResult {
  readonly series: DistrictSeries;
  /** District code -> window radius -> number of quarters. Radius 0 is the district's own median. For SOURCES.md. */
  readonly windowCounts: Map<string, Map<number, number>>;
  /** Qualifying sales (sale price filter passed) excluded because 總價元 is not greater than 0. */
  readonly zeroTotalPrice: number;
}

function totalPriceDecimals(): number {
  const spec = INDICATOR_SPECS.find((s) => s.id === 'medianTotalPrice');
  if (spec === undefined) throw new Error('indicator spec not found: medianTotalPrice');
  return spec.decimals;
}

/** District code -> 44 lists of 總價元, one per quarter, in input order. */
export function districtTotalPriceCells(
  sales: readonly LvrRecord[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): Map<string, number[][]> {
  return bucketByDistrictQuarter(totalPriceSales(sales), districts, quarters, (r) => r.totalPrice);
}

/** `sales` must be qualifying sales (filter applied, de-duplicated), as for buildSalePrice. */
export function buildMedianTotalPrice(
  sales: readonly LvrRecord[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): MedianTotalPriceResult {
  const options = {
    minCount: SALE_MIN_COUNT,
    decimals: totalPriceDecimals(),
    method: TOTAL_PRICE_POOLED_METHOD,
    errorCode: ERROR_CODE,
  };
  const buckets = districtTotalPriceCells(sales, districts, quarters);
  const series: DistrictSeries = {};
  const windowCounts = new Map<string, Map<number, number>>();
  for (const d of districts) {
    try {
      const built = pooledWindowSeries(buckets.get(d.code) as number[][], quarters, d.code, options);
      series[d.code] = built.records;
      windowCounts.set(d.code, built.radiusCounts);
    } catch (e) {
      if (e instanceof DataError && e.message.startsWith(`${ERROR_CODE}:`)) {
        throw new DataError(
          ERROR_CODE,
          e.subject,
          e.details.map((line) => line.replace('no qualifying sales in', 'no qualifying sales with a total price in')),
        );
      }
      throw e;
    }
  }
  const zeroTotalPrice = sales.filter((r) => !(r.totalPrice > 0)).length;
  return { series, windowCounts, zeroTotalPrice };
}

/** Builds the district median total price from the sale files already loaded for the sale price step. */
export function medianTotalPriceStep(): Step {
  return {
    name: 'median-total-price',
    run(ctx, state) {
      const load = (state.lvrSales ??= loadLvr(ctx, 'sale'));
      const built = buildMedianTotalPrice(load.qualifying, ctx.districts, ctx.quarters);
      state.medianTotalPrice = built.series;
      state.medianTotalPriceWindowCounts = built.windowCounts;
      state.notes.push(`median total price: ${built.zeroTotalPrice} qualifying sales excluded, 總價元 not greater than 0`);
    },
  };
}
