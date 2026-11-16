/**
 * Commuter pass series (Requirement 12.12, Decision D22).
 *
 *   commuterPassPrice(c, q)   = price of the latest product of c with start_date <= last day of q, else 0   (observed)
 *   commuterPassSubsidy(c, q) = 0 by definition (no local-government share is published)    (`commuter-subsidy-definition`)
 *   r0                        = 5,150,000 passes / 564 days        "more than" 5.15 million sold 2018-04-16 .. 2019-10-31 (lower bound)
 *   share(c, q)               = population(c, q) / (population(Taipei, q) + population(New Taipei, q))
 *   activeDays(c, q)          = days of q in 2018-04-16 .. 2019-10-31 when price(c, q) > 0
 *   heldDays(c, q)            = days of q after 2019-10-31 when price(c, q) > 0
 *   weight(c, q)              = r0 * activeDays(c, q) * share(c, q)
 *   commuterPassesSold        = apportion(5,150,000, weights of 2018Q2..2019Q4, both cities)   (exact part)
 *                               + round(r0 * heldDays(c, q) * share(c, q))                     (held rate after 2019-10-31)
 *                                                                                   (`commuter-passes-estimate`)
 *
 * Passes sold are 0 in every quarter with a price of 0 and before 2018-04-16. The price of a quarter is the
 * product in force on its last day, so a product that starts inside a quarter counts for the whole quarter
 * from 2018-04-16 on. Source: Newtalk, 2019-11-27, quoting the Taipei City Department of Transportation.
 */import type { DistrictRef } from '../../lib/districts.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import type { DistrictSeries } from '../indicators/series.ts';
import { apportion } from '../numeric.ts';
import { lookupEffective, type CommuterPassProductRow } from '../parsers/policy-tables.ts';
import {
  CITIES,
  cityTrack,
  dayNumber,
  estimatedRecord,
  observed,
  overlapDays,
  quarterDayRange,
  quarterLastDay,
  type CityTrack,
  type TrackCity,
} from './track.ts';

export const COMMUTER_PRICE_SERIES = 'commuterPassPrice';
export const COMMUTER_SUBSIDY_SERIES = 'commuterPassSubsidy';
export const COMMUTER_SOLD_SERIES = 'commuterPassesSold';
export const COMMUTER_PRICE_SOURCE = 'policy/trtc-products';
export const COMMUTER_SOLD_SOURCE = 'policy/taipei-dot-2019';
export const COMMUTER_SUBSIDY_METHOD = 'commuter-subsidy-definition';
export const COMMUTER_SOLD_METHOD = 'commuter-passes-estimate';

/** Lower bound of the passes sold from `PASS_SALES_START` to `CUMULATIVE_END` ("more than 5.15 million", Taipei City Department of Transportation via Newtalk, 2019-11-27). */
export const CUMULATIVE_PASSES = 5_150_000;
export const PASS_SALES_START = '2018-04-16';
/** Last day covered by the cumulative figure (end of October 2019). */
export const CUMULATIVE_END = '2019-10-31';
export const CUMULATIVE_FIRST_QUARTER: Quarter = '2018Q2';
export const CUMULATIVE_LAST_QUARTER: Quarter = '2019Q4';
/** Days from 2018-04-16 to 2019-10-31 inclusive. */
export const CUMULATIVE_DAYS = 564;

export function buildCommuterPassPrice(rows: readonly CommuterPassProductRow[], quarters: readonly Quarter[]): CityTrack {
  return cityTrack((city) =>
    quarters.map((q) => {
      const product = lookupEffective(rows, city, quarterLastDay(q));
      return product === undefined ? observed(0, COMMUTER_PRICE_SOURCE) : observed(product.priceTwd, product.source);
    }),
  );
}

export function buildCommuterPassSubsidy(quarters: readonly Quarter[]): CityTrack {
  return cityTrack(() => quarters.map(() => estimatedRecord(0, COMMUTER_PRICE_SOURCE, COMMUTER_SUBSIDY_METHOD)));
}

/** Resident population of each city per quarter: the sum of its districts (unrounded integer counts). */
export function cityPopulation(
  population: DistrictSeries,
  districts: readonly Pick<DistrictRef, 'code' | 'city'>[],
  quarters: readonly Quarter[],
): Record<TrackCity, number[]> {
  const out: Record<TrackCity, number[]> = { Taipei: quarters.map(() => 0), 'New Taipei': quarters.map(() => 0) };
  for (const d of districts) {
    const rows = population[d.code];
    if (rows === undefined || rows.length !== quarters.length) {
      throw new DataError('missing-population', `${COMMUTER_SOLD_SERIES} district ${d.code} ${quarters[0] ?? ''}`, ['population series is missing or has the wrong length']);
    }
    rows.forEach((r, k) => {
      if (r.value === null) {
        throw new DataError('missing-population', `${COMMUTER_SOLD_SERIES} district ${d.code} ${quarters[k]}`, ['population value is null']);
      }
      out[d.city][k]! += r.value;
    });
  }
  return out;
}

export function buildCommuterPassesSold(
  price: CityTrack,
  populationByCity: Record<TrackCity, readonly number[]>,
  quarters: readonly Quarter[],
): CityTrack {
  const r0 = CUMULATIVE_PASSES / CUMULATIVE_DAYS;
  const salesStart = dayNumber(PASS_SALES_START);
  const cutoff = dayNumber(CUMULATIVE_END) + 1;
  const ranges = quarters.map(quarterDayRange);

  const weights: Record<TrackCity, number[]> = { Taipei: [], 'New Taipei': [] };
  const held: Record<TrackCity, number[]> = { Taipei: [], 'New Taipei': [] };
  quarters.forEach((q, k) => {
    const total = populationByCity.Taipei[k]! + populationByCity['New Taipei'][k]!;
    for (const city of CITIES) {
      const range = ranges[k]!;
      const paid = price[city][k]!.value > 0;
      const active = paid ? overlapDays(salesStart, cutoff, range.start, range.endExclusive) : 0;
      const heldDays = paid ? overlapDays(cutoff, range.endExclusive, range.start, range.endExclusive) : 0;
      if (active + heldDays > 0 && !(total > 0)) {
        throw new DataError('missing-population', `${COMMUTER_SOLD_SERIES} ${city} ${q}`, [`population of both cities is ${total}`]);
      }
      const share = active + heldDays > 0 ? populationByCity[city][k]! / total : 0;
      weights[city].push(r0 * active * share);
      held[city].push(Math.round(r0 * heldDays * share));
    }
  });

  const first = quarters.indexOf(CUMULATIVE_FIRST_QUARTER);
  const last = quarters.indexOf(CUMULATIVE_LAST_QUARTER);
  if (first < 0 || last < first) {
    throw new DataError('missing-quarters', `${COMMUTER_SOLD_SERIES} ${CITIES[0]} ${CUMULATIVE_FIRST_QUARTER}`, [
      `the quarters ${CUMULATIVE_FIRST_QUARTER}..${CUMULATIVE_LAST_QUARTER} are needed for the cumulative figure`,
    ]);
  }
  // One split over the window and both cities: index = city offset + quarter offset.
  const window: number[] = [];
  for (const city of CITIES) window.push(...weights[city].slice(first, last + 1));
  if (!window.some((w) => w > 0)) {
    throw new DataError('no-active-days', `${COMMUTER_SOLD_SERIES} ${CITIES[0]} ${CUMULATIVE_FIRST_QUARTER}`, ['no quarter of the window has a pass price above 0']);
  }
  const split = apportion(CUMULATIVE_PASSES, window);
  const width = last - first + 1;

  return cityTrack((city) => {
    const cityIndex = CITIES.indexOf(city);
    return quarters.map((_, k) => {
      const exact = k >= first && k <= last ? split[cityIndex * width + (k - first)]! : 0;
      const value = exact + held[city][k]!;
      return estimatedRecord(value, COMMUTER_SOLD_SOURCE, COMMUTER_SOLD_METHOD);
    });
  });
}
