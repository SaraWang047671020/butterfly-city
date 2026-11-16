/**
 * Rent subsidy series (Requirements 12.6, 12.7).
 *
 *   rentSubsidyHouseholds(c, q) = hh613(c, q) + hh631(c, q)     a table without a figure for q counts as 0; observed
 *   amount2023(c)               = round(total2023(c) · 1000 / householdMonths2023(c))     NT$ per household-month
 *   rentSubsidyAmountPerHousehold(c, q) = amount2023(c) for every q; estimated
 *                                 2023 quarters: `rent-amount-annual-average`, other quarters: `rent-amount-carry`
 *
 * The 169800 total is in NT$ thousand, hence the factor 1000. A result outside 1,000..10,000 stops the build
 * (a guard against a unit error such as NT$ thousand versus NT$).
 */
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import type { E3010Row, PolicyCity, RentAmountRow } from '../parsers/rent-subsidy.ts';
import { cityTrack, estimatedRecord, observed, type CityTrack, type TrackCity } from './track.ts';

export const RENT_HOUSEHOLDS_SERIES = 'rentSubsidyHouseholds';
export const RENT_AMOUNT_SERIES = 'rentSubsidyAmountPerHousehold';
export const RENT_HOUSEHOLDS_SOURCE = 'policy/moi-e3010';
export const RENT_AMOUNT_SOURCE = 'policy/moi-169800';
export const RENT_AMOUNT_BASE_YEAR = 2023;
export const RENT_AMOUNT_MIN = 1000;
export const RENT_AMOUNT_MAX = 10000;

/** Households per city and quarter of one E3010 table; a repeated city and quarter stops the build. */
function tableTotals(rows: readonly E3010Row[], table: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.city}|${r.quarter}`;
    if (out.has(key)) {
      throw new DataError('duplicate-row', `${RENT_HOUSEHOLDS_SERIES} ${r.city} ${r.quarter}`, [`table: ${table}`]);
    }
    out.set(key, r.value);
  }
  return out;
}

/** Rows of the integrated housing subsidy table (6_1_3) and the central expanded plan table (6_3_1). */
export function buildRentSubsidyHouseholds(
  rows613: readonly E3010Row[],
  rows631: readonly E3010Row[],
  quarters: readonly Quarter[],
): CityTrack {
  const a = tableTotals(rows613, '6_1_3');
  const b = tableTotals(rows631, '6_3_1');
  return cityTrack((city) =>
    quarters.map((q) => {
      const key = `${city}|${q}`;
      const value = (a.get(key) ?? 0) + (b.get(key) ?? 0);
      if (!Number.isFinite(value) || value < 0) {
        throw new DataError('invalid-value', `${RENT_HOUSEHOLDS_SERIES} ${city} ${q}`, [`value: ${String(value)}`]);
      }
      return observed(value, RENT_HOUSEHOLDS_SOURCE);
    }),
  );
}

/** The 2023 subsidy per household-month of each city, in NT$, checked against the guard. */
export function rentAmountBase(rows: readonly RentAmountRow[]): Record<PolicyCity, number> {
  const out = {} as Record<PolicyCity, number>;
  for (const city of ['Taipei', 'New Taipei'] as const) {
    const q = `${RENT_AMOUNT_BASE_YEAR}Q1`;
    const subject = `${RENT_AMOUNT_SERIES} ${city} ${q}`;
    const own = rows.filter((r) => r.city === city && r.year === RENT_AMOUNT_BASE_YEAR);
    if (own.length === 0) throw new DataError('missing-row', subject, [`no ${RENT_AMOUNT_BASE_YEAR} row for ${city} in dataset 169800`]);
    if (own.length > 1) throw new DataError('duplicate-row', subject, [`${own.length} ${RENT_AMOUNT_BASE_YEAR} rows in dataset 169800`]);
    const { householdMonths, amountThousand } = own[0]!;
    if (!(householdMonths > 0)) {
      throw new DataError('invalid-value', subject, [`household-months: ${householdMonths} (expected a positive number)`]);
    }
    if (!(amountThousand >= 0)) {
      throw new DataError('invalid-value', subject, [`amount: ${amountThousand} NT$ thousand (expected a non-negative number)`]);
    }
    const amount = Math.round((amountThousand * 1000) / householdMonths);
    if (amount < RENT_AMOUNT_MIN || amount > RENT_AMOUNT_MAX) {
      throw new DataError('amount-out-of-range', subject, [
        `amount: NT$ ${amount} per household-month (expected ${RENT_AMOUNT_MIN}..${RENT_AMOUNT_MAX})`,
        `total: ${amountThousand} NT$ thousand, household-months: ${householdMonths}`,
      ]);
    }
    out[city] = amount;
  }
  return out;
}

export function buildRentSubsidyAmount(rows: readonly RentAmountRow[], quarters: readonly Quarter[]): CityTrack {
  const base = rentAmountBase(rows);
  return cityTrack((city: TrackCity) =>
    quarters.map((q) =>
      estimatedRecord(
        base[city],
        RENT_AMOUNT_SOURCE,
        q.startsWith(`${RENT_AMOUNT_BASE_YEAR}Q`) ? 'rent-amount-annual-average' : 'rent-amount-carry',
      ),
    ),
  );
}
