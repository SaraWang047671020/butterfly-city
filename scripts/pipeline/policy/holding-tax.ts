/**
 * Holding tax series (Requirements 12.9, 12.10, 12.11).
 *
 *   rate(c, q)        = row of city c with the latest effective_date ≤ last day of q, observed; the record `source`
 *                       is the Source_Id of that row. If the city has no such row (New Taipei before 2017-07-01),
 *                       both rates = lowest_rate of the `statutory` row in force on that day, estimated with
 *                       `holding-tax-statutory-minimum` (source: the statutory row's source).
 *   houseTaxRevenue(c, q) = apportion(round(annual(c, year(q))), [1, 1, 1, 1])[quarter index]
 *                       NT$ thousand, estimated with `house-tax-even-split`. The annual amount can have decimals,
 *                       so it is rounded to an integer first; the four quarters then sum to that integer.
 */
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import { apportion } from '../numeric.ts';
import type { HouseTaxRow } from '../parsers/house-tax.ts';
import { lookupEffective, type HoldingTaxRateRow } from '../parsers/policy-tables.ts';
import { cityTrack, estimatedRecord, observed, quarterLastDay, type CityTrack } from './track.ts';

export const HOLDING_TAX_LOWEST_SERIES = 'holdingTaxRateLowestTier';
export const HOLDING_TAX_HIGHEST_SERIES = 'holdingTaxRateHighestTier';
export const HOUSE_TAX_REVENUE_SERIES = 'houseTaxRevenue';
export const HOUSE_TAX_SOURCE = 'policy/mof-6742';
export const HOLDING_TAX_FALLBACK_METHOD = 'holding-tax-statutory-minimum';
export const HOUSE_TAX_METHOD = 'house-tax-even-split';

export interface HoldingTaxRates {
  readonly lowest: CityTrack;
  readonly highest: CityTrack;
}

export function buildHoldingTaxRates(rows: readonly HoldingTaxRateRow[], quarters: readonly Quarter[]): HoldingTaxRates {
  const pick = (which: 'lowestRate' | 'highestRate', series: string): CityTrack =>
    cityTrack((city) =>
      quarters.map((q) => {
        const day = quarterLastDay(q);
        const own = lookupEffective(rows, city, day);
        if (own !== undefined) return observed(own[which], own.source);
        const statutory = lookupEffective(rows, 'statutory', day);
        if (statutory === undefined) {
          throw new DataError('no-rate', `${series} ${city} ${q}`, [`no ${city} or statutory row in force on ${day} in holding-tax-rates.csv`]);
        }
        return estimatedRecord(statutory.lowestRate, statutory.source, HOLDING_TAX_FALLBACK_METHOD);
      }),
    );
  return {
    lowest: pick('lowestRate', HOLDING_TAX_LOWEST_SERIES),
    highest: pick('highestRate', HOLDING_TAX_HIGHEST_SERIES),
  };
}

export function buildHouseTaxRevenue(rows: readonly HouseTaxRow[], quarters: readonly Quarter[]): CityTrack {
  return cityTrack((city) =>
    quarters.map((q) => {
      const year = Number(q.slice(0, 4));
      const annual = rows.find((r) => r.city === city && r.year === year);
      if (annual === undefined || !Number.isFinite(annual.amountThousand) || annual.amountThousand < 0) {
        throw new DataError('no-annual-value', `${HOUSE_TAX_REVENUE_SERIES} ${city} ${q}`, [`no house tax figure for ${city} ${year} in dataset 6742`]);
      }
      const share = apportion(Math.round(annual.amountThousand), [1, 1, 1, 1])[Number(q.slice(5)) - 1]!;
      return estimatedRecord(share, HOUSE_TAX_SOURCE, HOUSE_TAX_METHOD);
    }),
  );
}
