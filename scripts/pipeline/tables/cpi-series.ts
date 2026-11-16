/**
 * Which CPI rent series each city uses (Requirement 9.2). Selecting the series assigned to the district's
 * city is part of the correctness of the rent index: a rent index computed from any other series is invalid.
 *
 * Series ids are the Source_Ids of the sources registry.
 *   Taipei      -> Taipei DBAS 131822: rows with 基本分類 房租 and 縣市別代碼 63000
 *   New Taipei  -> DGBAS 6019 XML: observations with Item 房租 and TYPE 原始值
 */
import type { City } from '../../lib/districts.ts';
import { DataError } from '../errors.ts';

export type CpiSeriesId = 'macro/taipei-dbas-131822' | 'macro/dgbas-6019';

/** The required assignment. */
export const CPI_SERIES_BY_CITY: Readonly<Record<City, CpiSeriesId>> = {
  Taipei: 'macro/taipei-dbas-131822',
  'New Taipei': 'macro/dgbas-6019',
};

export function cpiSeriesFor(city: City): CpiSeriesId {
  return CPI_SERIES_BY_CITY[city];
}

/**
 * Checks that the series each district resolves to through `mapping` is the one required for its city.
 * Throws DataError naming the District_Code and the series it was mapped to (Requirement 9.10).
 */
export function checkCpiMapping(
  districts: readonly { readonly code: string; readonly city: City }[],
  mapping: Readonly<Partial<Record<City, string>>> = CPI_SERIES_BY_CITY,
): void {
  for (const d of districts) {
    const mapped = mapping[d.city];
    const required = CPI_SERIES_BY_CITY[d.city];
    if (mapped !== required) {
      throw new DataError('cpi-series-mismatch', `${d.code} mapped to ${mapped ?? 'no series'}`, [
        `District_Code: ${d.code} (${d.city})`,
        `mapped series: ${mapped ?? 'none'}`,
        `required series: ${required}`,
      ]);
    }
  }
}
