// Derived_Baseline: household and renter counts, renter shares, rent burden and mean commute time.
// Pure functions. Every function returns a result value; a missing or non-positive divisor gives
// `derived-input-invalid` (Requirements 2.5, 2.6, 6.11).

import type { CityName, DistrictCode, QuarterKey } from '../types/data-files.ts';
import type { CommuteMatrix, EngineBaseline, EngineError, ParameterTable } from '../types/simulation.ts';
import { derivedInputInvalid, err, ok } from './errors.ts';
import { clamp } from './numeric.ts';
import { expandId, jobShareId, scalar } from './params.ts';

export type DerivedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineError };

/** Shared per district and quarter facts used by both housing tool rules and the Ghost rule. */
export interface DistrictFacts {
  readonly code: DistrictCode;
  readonly city: CityName;
  readonly population: number;
  readonly householdSize: number;
  /** H_d = P_d / householdSize */
  readonly households: number;
  /** Hr_d = H_d x renterRate */
  readonly renterHouseholds: number;
  /** Hr_d x householdSize */
  readonly renterPersons: number;
  /** m_d = I_d / 12 */
  readonly monthlyIncome: number;
  /** k_d = S / m_d x 100: percentage points of burden per TWD per m2 per month */
  readonly k: number;
}

function positive(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

function baselineValue(
  baseline: EngineBaseline,
  indicator: string,
  code: DistrictCode,
  quarterIdx: number,
): number | null {
  const series = baseline.indicators[indicator];
  if (series === undefined || !Object.hasOwn(series, code)) return null;
  const v = series[code]?.[quarterIdx];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function quarterOf(baseline: EngineBaseline, quarterIdx: number): QuarterKey | string {
  return baseline.quarters[quarterIdx] ?? String(quarterIdx);
}

function cityOf(baseline: EngineBaseline, code: DistrictCode): CityName | undefined {
  return baseline.districts.find((d) => d.code === code)?.city;
}

/** Facts of one district in the quarter with index `quarterIdx` (0 is the first Baseline quarter). */
export function districtFacts(
  baseline: EngineBaseline,
  params: ParameterTable,
  code: DistrictCode,
  quarterIdx: number,
): DerivedResult<DistrictFacts> {
  const q = quarterOf(baseline, quarterIdx);
  const city = cityOf(baseline, code);
  if (city === undefined) return err(derivedInputInvalid('city', code, q));

  const population = baselineValue(baseline, 'population', code, quarterIdx);
  if (population === null || population < 0) return err(derivedInputInvalid('population', code, q));

  const householdSize = scalar(params, expandId('housing.householdSize.<city>', { city }));
  if (!positive(householdSize)) return err(derivedInputInvalid('housing.householdSize', code, q));

  const renterRate = scalar(params, expandId('housing.renterRate.<city>', { city }));
  if (!Number.isFinite(renterRate) || renterRate < 0) {
    return err(derivedInputInvalid('housing.renterRate', code, q));
  }

  const dwellingSize = scalar(params, 'housing.dwellingSize');
  if (!positive(dwellingSize)) return err(derivedInputInvalid('housing.dwellingSize', code, q));

  const income = baselineValue(baseline, 'householdIncome', code, quarterIdx);
  if (income === null || !positive(income)) return err(derivedInputInvalid('householdIncome', code, q));

  const households = population / householdSize;
  const renterHouseholds = households * renterRate;
  const monthlyIncome = income / 12;
  return ok({
    code,
    city,
    population,
    householdSize,
    households,
    renterHouseholds,
    renterPersons: renterHouseholds * householdSize,
    monthlyIncome,
    k: (dwellingSize / monthlyIncome) * 100,
  });
}

/** Renter share s_d = Hr_d / sum of Hr_e over the districts of the same city; sums to 1 per city. */
export function renterShare(
  baseline: EngineBaseline,
  params: ParameterTable,
  code: DistrictCode,
  quarterIdx: number,
): DerivedResult<number> {
  const q = quarterOf(baseline, quarterIdx);
  const own = districtFacts(baseline, params, code, quarterIdx);
  if (!own.ok) return own;
  let total = 0;
  for (const d of baseline.districts) {
    if (d.city !== own.value.city) continue;
    const f = districtFacts(baseline, params, d.code, quarterIdx);
    if (!f.ok) return f;
    total += f.value.renterHouseholds;
  }
  // A district without renters has share 0; only a city without any renters has no defined share.
  if (!positive(total)) {
    return err(derivedInputInvalid('renterShare', code, q));
  }
  return ok(own.value.renterHouseholds / total);
}

/** Derived_Baseline rent burden in percent: clamp(rent x S / (I / 12) x 100, 0, 100). */
export function derivedRentBurden(
  baseline: EngineBaseline,
  params: ParameterTable,
  code: DistrictCode,
  quarterIdx: number,
): DerivedResult<number> {
  const q = quarterOf(baseline, quarterIdx);
  const f = districtFacts(baseline, params, code, quarterIdx);
  if (!f.ok) return f;
  const rent = baselineValue(baseline, 'rent', code, quarterIdx);
  if (rent === null) return err(derivedInputInvalid('rent', code, q));
  return ok(clamp(rent * f.value.k, 0, 100));
}

/** Derived_Baseline mean commute time: sum over j of commute.jobShare.<j> x matrix[d][j]. */
export function derivedMeanCommuteTime(
  params: ParameterTable,
  commute: CommuteMatrix,
  code: DistrictCode,
  quarter: QuarterKey | string,
): DerivedResult<number> {
  const row = commute.codes.indexOf(code);
  const line = row >= 0 ? commute.minutes[row] : undefined;
  if (line === undefined) return err(derivedInputInvalid('commute.matrix', code, quarter));
  let sum = 0;
  for (let j = 0; j < commute.codes.length; j++) {
    const target = commute.codes[j];
    const minutes = line[j];
    if (target === undefined || minutes === undefined || !Number.isFinite(minutes)) {
      return err(derivedInputInvalid('commute.matrix', code, quarter));
    }
    const share = scalar(params, jobShareId(target));
    if (!Number.isFinite(share)) return err(derivedInputInvalid('commute.jobShare', code, quarter));
    sum += share * minutes;
  }
  return ok(sum);
}
