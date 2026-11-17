/**
 * Survey check of the commute matrix (Requirement 24.8).
 *
 * Mean modelled time from the New Taipei districts to the Taipei districts, weighted by origin population
 * (mean of the four 2025 quarter-end values) and by `jobShare` renormalized over the Taipei districts:
 *
 *   modelled = sum_o sum_w pop(o) * share(w) * t(o, w) / (sum_o pop(o) * sum_w share(w))
 *
 * The result is reported only. It changes no matrix cell, no constant, no parameter and not the exit code.
 */
import type { CityName } from '../../../src/types/data-files.ts';
import type { DistrictSeries } from '../indicators/series.ts';
import { mean, stableSum } from '../numeric.ts';

/** Commuting time reported by the survey, in minutes ("about 57"). */
export const SURVEY_MINUTES = 57;

export interface SurveyCheckInput {
  readonly codes: readonly string[];
  readonly minutes: readonly (readonly number[])[];
  readonly cityOf: ReadonlyMap<string, CityName>;
  /** Mean 2025 population per District_Code. */
  readonly population: ReadonlyMap<string, number>;
  /** jobShares(...) over the 41 districts. */
  readonly jobShare: ReadonlyMap<string, number>;
}

export interface SurveyCheckResult {
  readonly modelled: number;
  readonly survey: number;
  /** modelled - survey. */
  readonly difference: number;
}

/** Mean of the last four quarter-end values (the 2025 quarters) per district. */
export function population2025Mean(series: DistrictSeries): Map<string, number> {
  const out = new Map<string, number>();
  for (const [code, records] of Object.entries(series)) {
    const last = records.slice(-4);
    if (last.length !== 4) throw new Error(`population2025Mean: district ${code} has fewer than 4 quarters`);
    out.set(code, mean(last.map((r) => r.value as number)));
  }
  return out;
}

export function surveyCheck(input: SurveyCheckInput): SurveyCheckResult {
  const idx = (city: CityName): number[] =>
    input.codes.flatMap((c, i) => (input.cityOf.get(c) === city ? [i] : []));
  const origins = idx('New Taipei');
  const targets = idx('Taipei');
  if (origins.length === 0 || targets.length === 0) throw new Error('surveyCheck: both cities need at least one district');
  const get = (m: ReadonlyMap<string, number>, code: string, what: string): number => {
    const v = m.get(code);
    if (v === undefined) throw new Error(`surveyCheck: no ${what} for district ${code}`);
    return v;
  };
  const shareSum = stableSum(targets.map((w) => get(input.jobShare, input.codes[w] as string, 'jobShare')));
  if (!(shareSum > 0)) throw new Error('surveyCheck: Taipei job shares sum to 0');
  const popSum = stableSum(origins.map((o) => get(input.population, input.codes[o] as string, 'population')));
  if (!(popSum > 0)) throw new Error('surveyCheck: New Taipei population sums to 0');
  const terms: number[] = [];
  for (const o of origins) {
    const p = get(input.population, input.codes[o] as string, 'population');
    for (const w of targets) {
      terms.push(p * get(input.jobShare, input.codes[w] as string, 'jobShare') * (input.minutes[o]?.[w] as number));
    }
  }
  const modelled = stableSum(terms) / (popSum * shareSum);
  return { modelled, survey: SURVEY_MINUTES, difference: modelled - SURVEY_MINUTES };
}

/** `commute check: modelled <x> min, survey about 57 min, difference <±y>`. */
export function surveyCheckLine(r: SurveyCheckResult): string {
  const sign = r.difference >= 0 ? '+' : '-';
  return `commute check: modelled ${r.modelled.toFixed(1)} min, survey about ${r.survey} min, difference ${sign}${Math.abs(r.difference).toFixed(1)}`;
}
