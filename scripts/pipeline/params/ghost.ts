/**
 * Ghost parameters (Requirements 22.7, 22.8, 22.9). This file holds the rent part (task 25.4);
 * the commute shares (`ghost.shareCommuteWithin`, `ghost.sensitivityCommute`, task 25.5) are added below it.
 *
 * Rent burden (reference year 2023, design "ghost.shareRent and ghost.sensitivityRent"):
 *   m_d       = mean of householdIncome(d) over 2023Q1..Q4          TWD per household per year
 *   sigma_d   = (ln Q3_d - ln Q1_d) / (2 * 0.6745)                  Q1, Q3: FIA total row of income year 2023
 *   R_d       = mean of rent(d) over 2023Q1..Q4 * housing.dwellingSize
 *   tail_d(t) = P(burden > t) = Phi((ln(1200 * R_d / t) - ln m_d) / sigma_d)
 *   shareRent       = sum(pop_d * renterRate(c_d) * tail_d(50)) / sum(pop_d)
 *   sensitivityRent = sum(renters_d * (tail_d(49) - tail_d(50))) / sum(renters_d),  renters_d = pop_d * renterRate(c_d)
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { Citation, ScalarParameter } from '../../../src/types/simulation.ts';
import { DISTRICTS, districtByZh, type City } from '../../lib/districts.ts';
import { readOdsRows } from '../../lib/zip.ts';
import { DataError } from '../errors.ts';
import { normalCdf, stableSum } from '../numeric.ts';

export const SHARE_RENT_ID = 'ghost.shareRent';
export const SENSITIVITY_RENT_ID = 'ghost.sensitivityRent';
export const SHARE_RENT_UNIT = 'share of residents';
export const SENSITIVITY_RENT_UNIT = 'share of renter persons per percentage point of rent burden';

/** Reference year of the rent ghost parameters: the last year with observed FIA data. */
export const GHOST_REFERENCE_YEAR = 2023;
/** Standard normal quantile of the third quartile: the interquartile range equals 2 * 0.6745 sigma. */
export const QUARTILE_Z = 0.6745;

export const FIA_CITATION: Citation = {
  citation: 'Ministry of Finance (Fiscal Information Agency), comprehensive income tax statistics by village, income year 2023 (112_165-9.csv); Open Government Data License 1.0',
  url: 'https://data.gov.tw/dataset/103066',
};

/** Inputs of one district, all for the reference year. */
export interface RentGhostDistrictInput {
  readonly districtCode: string;
  readonly city: City;
  /** householdIncome over 2023Q1..Q4, TWD per household per year. */
  readonly householdIncome: readonly number[];
  /** rent over 2023Q1..Q4, TWD per square metre per month. */
  readonly rent: readonly number[];
  /** Population in 2023Q4, persons. */
  readonly population: number;
  /** FIA first and third quartile of the district total row, income year 2023 (same unit; only the ratio is used). */
  readonly q1: number;
  readonly q3: number;
}

export interface RentGhostInput {
  readonly districts: readonly RentGhostDistrictInput[];
  /** `housing.dwellingSize`, square metres. */
  readonly dwellingSize: number;
  /** `housing.renterRate.<city>`, share of households. */
  readonly renterRate: Readonly<Record<City, number>>;
  /** `ghost.rentThreshold`, percent of income. */
  readonly rentThreshold: number;
}

export interface RentGhostResult {
  readonly shareRent: ScalarParameter;
  readonly sensitivityRent: ScalarParameter;
}

function meanOf(values: readonly number[]): number {
  return stableSum(values) / values.length;
}

/** Stops the build for a district whose quartiles cannot define the log-normal scale (Requirement 22.8). */
export function checkQuartiles(districtCode: string, q1: number, q3: number): void {
  if (!(q1 > 0) || !(q1 < q3)) {
    throw new DataError('fia-quartiles-invalid', districtCode, [
      `District_Code ${districtCode}: Q1 ${q1}, Q3 ${q3}; need 0 < Q1 < Q3`,
    ]);
  }
}

export function rentGhostParams(input: RentGhostInput): RentGhostResult {
  const t = input.rentThreshold;
  if (!Number.isFinite(t) || t <= 1) {
    throw new DataError('ghost-rent-threshold-invalid', 'ghost.rentThreshold', [`rent threshold ${t}; need a number above 1`]);
  }
  const expected = new Set(DISTRICTS.map((d) => d.code));
  const seen = new Set(input.districts.map((d) => d.districtCode));
  const missing = [...expected].filter((c) => !seen.has(c)).sort();
  if (missing.length > 0 || seen.size !== input.districts.length) {
    throw new DataError('ghost-rent-districts', 'ghost', [`need exactly the 41 districts; missing ${missing.join(', ') || 'none'}`]);
  }
  for (const d of input.districts) checkQuartiles(d.districtCode, d.q1, d.q3);

  const popTerms: number[] = [];
  const shareTerms: number[] = [];
  const renterTerms: number[] = [];
  const sensTerms: number[] = [];
  for (const d of input.districts) {
    if (d.householdIncome.length !== 4 || d.rent.length !== 4) {
      throw new DataError('ghost-rent-quarters', d.districtCode, ['householdIncome and rent need the four quarters of 2023']);
    }
    const m = meanOf(d.householdIncome);
    const rentMonthly = meanOf(d.rent) * input.dwellingSize;
    if (!(m > 0) || !(rentMonthly > 0) || !(d.population > 0)) {
      throw new DataError('ghost-rent-inputs', d.districtCode, [`income ${m}, monthly rent ${rentMonthly}, population ${d.population}; all must be positive`]);
    }
    const sigma = (Math.log(d.q3) - Math.log(d.q1)) / (2 * QUARTILE_Z);
    const tail = (threshold: number): number => normalCdf((Math.log((1200 * rentMonthly) / threshold) - Math.log(m)) / sigma);
    const rate = input.renterRate[d.city];
    const tail50 = tail(t);
    const tail49 = tail(t - 1);
    const renters = d.population * rate;
    popTerms.push(d.population);
    shareTerms.push(renters * tail50);
    renterTerms.push(renters);
    sensTerms.push(renters * (tail49 - tail50));
  }
  const shareRent = stableSum(shareTerms) / stableSum(popTerms);
  const sensitivityRent = stableSum(sensTerms) / stableSum(renterTerms);

  const assumptions = [
    `Reference year ${GHOST_REFERENCE_YEAR}, the last year with observed FIA data (2024 and 2025 are extrapolated).`,
    'Household income of each district is assumed log-normal. Its median is the mean of the district householdIncome indicator over the four quarters of 2023, which is the income the engine uses.',
    'Its scale is (ln Q3 - ln Q1) / (2 x 0.6745) from the first and third quartile of the district total row of the FIA file for income year 2023, so the spread is that of FIA income: FIA income is per tax unit, not per household, and excludes transfer income (for example pensions, allowances and subsidies), so it can be more or less dispersed than household disposable income.',
    'The log-normal form is a two-parameter approximation: it has no heavy upper tail or mass at low incomes, and the tail at a burden near the threshold depends on that form.',
    'Renters are assumed to have the same income distribution as all households of the district, although renter households usually have lower income, which would raise the share.',
    'The rent of the reference dwelling is the district mean 2023 rent indicator multiplied by housing.dwellingSize.',
    'Burden is monthly rent divided by monthly income (annual income / 12), in percent; a household has a rent burden above the threshold when its income is below 1200 x rent / threshold.',
    'The renter rate is the 2020 census value of the city (a single-year value) applied to the 2023Q4 population of each district.',
  ];
  const shareMethod = [
    `ghost.shareRent = sum over the 41 districts of population x renterRate(city) x P(burden > ${t} percent), divided by the total population; population is 2023Q4.`,
    ...assumptions,
  ].join(' ');
  const sensMethod = [
    `ghost.sensitivityRent = sum over the 41 districts of renter persons x (P(burden > ${t - 1}) - P(burden > ${t})), divided by total renter persons; this is the change of the share per 1 percentage point of burden. Renter persons are 2023Q4 population x renterRate(city).`,
    ...assumptions,
  ].join(' ');

  const shareEntry: ScalarParameter = {
    kind: 'scalar',
    value: shareRent,
    unit: SHARE_RENT_UNIT,
    status: 'secondary',
    source: FIA_CITATION,
    estimated: { method: shareMethod },
  };
  const sensEntry: ScalarParameter = {
    kind: 'scalar',
    value: sensitivityRent,
    unit: SENSITIVITY_RENT_UNIT,
    status: 'secondary',
    source: FIA_CITATION,
    estimated: { method: sensMethod },
  };
  for (const [id, entry] of [[SHARE_RENT_ID, shareEntry], [SENSITIVITY_RENT_ID, sensEntry]] as const) {
    const issues = checkParameterEntry(id, entry);
    if (issues.length > 0) throw new DataError('ghost-entry-invalid', id, issues.map((i) => i.problem));
  }
  return { shareRent: shareEntry, sensitivityRent: sensEntry };
}

// ---------------------------------------------------------------------------------------------
// Commute shares (Requirement 22.9, task 25.5)
// ---------------------------------------------------------------------------------------------

export const SHARE_COMMUTE_WITHIN_ID = 'ghost.shareCommuteWithin';
export const SENSITIVITY_COMMUTE_ID = 'ghost.sensitivityCommute';
export const SHARE_COMMUTE_WITHIN_UNIT = 'share of employed residents';
export const SENSITIVITY_COMMUTE_UNIT = 'share of employed residents per minute of one-way commute time';

/** Commute-time threshold of the within-threshold share, minutes (`ghost.commuteThreshold` value). */
export const COMMUTE_THRESHOLD_MINUTES = 60;
/** Lower end of the `ghost.shareCommuteWithin` range (`ghost.commuteThreshold` low), minutes. */
export const COMMUTE_THRESHOLD_LOW_MINUTES = 45;

export const WORKPLACE_TABLE_PATH: Readonly<Record<City, string>> = {
  Taipei: 'census/census2020-taipei-s014-workplace.ods',
  'New Taipei': 'census/census2020-ntpc-s014-workplace.ods',
};

export const CENSUS_WORKPLACE_CITATION: Citation = {
  citation: 'DGBAS, 2020 Population and Housing Census, table 14 (employed residents by place of work), Taipei City and New Taipei City reports; Open Government Data License 1.0',
  url: 'https://data.gov.tw/dataset/10906',
};

const CITY_ZH_WORKPLACE: Readonly<Record<City, string>> = { Taipei: '臺北市', 'New Taipei': '新北市' };

/** One residence district of table 14: employed residents by where they work. */
export interface WorkplaceRow {
  readonly total: number;
  readonly sameDistrict: number;
  readonly otherDistrictSameCity: number;
  readonly otherCountyOrAbroad: number;
}

export interface CityWorkplace {
  readonly city: City;
  /** District rows keyed by District_Code. */
  readonly districts: ReadonlyMap<string, WorkplaceRow>;
  /** Category totals over the districts of the city. */
  readonly totals: WorkplaceRow;
}

function wholeCount(cell: string | undefined): number | undefined {
  const s = (cell ?? '').replace(/[\s,]/g, '');
  return /^\d+$/.test(s) ? Number(s) : undefined;
}

/**
 * Parses table 14 rows (from `readOdsRows`): the first block ("total") has one row per district,
 * [name, total, same district, other district of the city, other county, city or overseas].
 * Later blocks repeat the districts by sex, so only the first occurrence of each district is kept.
 */
export function parseCensusWorkplaceRows(rows: readonly (readonly string[])[], file: string, city: City): CityWorkplace {
  const cityZh = CITY_ZH_WORKPLACE[city];
  const districts = new Map<string, WorkplaceRow>();
  rows.forEach((r, i) => {
    const d = districtByZh(cityZh + (r[0] ?? ''));
    if (d === undefined || districts.has(d.code)) return;
    const nums = r.slice(1, 5).map(wholeCount);
    if (r.length < 5 || nums.some((n) => n === undefined)) {
      throw new DataError('workplace-row-invalid', `${file} row ${i + 1}`, [`row ${r.join('|')} does not have four integer counts`]);
    }
    const [total, same, other, county] = nums as [number, number, number, number];
    if (same + other + county !== total) {
      throw new DataError('workplace-row-total', `${file} row ${i + 1}`, [`${r[0]}: total ${total}, categories sum ${same + other + county}`]);
    }
    districts.set(d.code, { total, sameDistrict: same, otherDistrictSameCity: other, otherCountyOrAbroad: county });
  });
  const missing = DISTRICTS.filter((d) => d.city === city && !districts.has(d.code)).map((d) => d.code);
  if (missing.length > 0) throw new DataError('workplace-missing-districts', file, [`city: ${city}`, `missing: ${missing.join(', ')}`]);
  const rowsList = [...districts.values()];
  const totals: WorkplaceRow = {
    total: stableSum(rowsList.map((x) => x.total)),
    sameDistrict: stableSum(rowsList.map((x) => x.sameDistrict)),
    otherDistrictSameCity: stableSum(rowsList.map((x) => x.otherDistrictSameCity)),
    otherCountyOrAbroad: stableSum(rowsList.map((x) => x.otherCountyOrAbroad)),
  };
  return { city, districts, totals };
}

/** Reads one table-14 ODS file. */
export function parseCensusWorkplaceOds(bytes: Buffer, file: string, city: City): CityWorkplace {
  let rows: string[][];
  try {
    rows = readOdsRows(bytes);
  } catch (e) {
    throw new DataError('workplace-unreadable', file, [(e as Error).message]);
  }
  return parseCensusWorkplaceRows(rows, file, city);
}

export interface CommuteGhostInput {
  readonly workplace: readonly CityWorkplace[];
  /** `commute.jobShare.<code>` per district (any positive weights per district work). */
  readonly jobShare: ReadonlyMap<string, number>;
  /** Commute_Matrix: `minutes[i][j]` is the one-way time from `codes[i]` to `codes[j]`. */
  readonly matrix: { readonly codes: readonly string[]; readonly minutes: readonly (readonly number[])[] };
}

export interface CommuteGhostResult {
  readonly shareCommuteWithin: ScalarParameter;
  readonly sensitivityCommute: ScalarParameter;
  /** Unrounded shares, for reports and tests. */
  readonly within45: number;
  readonly within60: number;
}

export function commuteGhostParams(input: CommuteGhostInput): CommuteGhostResult {
  const index = new Map(input.matrix.codes.map((c, i) => [c, i]));
  const cityOf = new Map(DISTRICTS.map((d) => [d.code, d.city]));
  const t = COMMUTE_THRESHOLD_MINUTES;
  const t0 = COMMUTE_THRESHOLD_LOW_MINUTES;
  const cities = new Set(input.workplace.map((w) => w.city));
  if (cities.size !== 2 || input.workplace.length !== 2) {
    throw new DataError('ghost-commute-cities', 'ghost', ['need the table 14 data of both cities, once each']);
  }
  let all = 0;
  let in60 = 0;
  let in45 = 0;
  let band = 0;
  for (const w of input.workplace) {
    const otherCity: City = w.city === 'Taipei' ? 'New Taipei' : 'Taipei';
    const weightOf = (code: string): number => {
      const v = input.jobShare.get(code);
      if (v === undefined || !(v >= 0)) throw new DataError('ghost-commute-jobshare', code, [`no valid job share for district ${code}`]);
      return v;
    };
    for (const [home, row] of w.districts) {
      const h = index.get(home);
      if (h === undefined) throw new DataError('ghost-commute-matrix', home, [`district ${home} is not in the Commute_Matrix`]);
      const spread = (count: number, targets: readonly string[]): void => {
        if (count === 0) return;
        const weights = targets.map(weightOf);
        const sum = stableSum(weights);
        if (!(sum > 0)) throw new DataError('ghost-commute-jobshare', home, ['job shares of the target districts sum to 0']);
        targets.forEach((code, k) => {
          const j = index.get(code);
          if (j === undefined) throw new DataError('ghost-commute-matrix', code, [`district ${code} is not in the Commute_Matrix`]);
          const mass = (count * weights[k]!) / sum;
          const minutes = input.matrix.minutes[h]![j]!;
          if (minutes <= t) in60 += mass;
          if (minutes <= t0) in45 += mass;
          if (minutes > t - 1 && minutes <= t) band += mass;
        });
      };
      // Same district: time 0 minutes.
      all += row.total;
      in60 += row.sameDistrict;
      in45 += row.sameDistrict;
      spread(row.otherDistrictSameCity, DISTRICTS.filter((d) => d.city === w.city && d.code !== home).map((d) => d.code));
      spread(row.otherCountyOrAbroad, DISTRICTS.filter((d) => cityOf.get(d.code) === otherCity).map((d) => d.code));
    }
  }
  if (!(all > 0)) throw new DataError('ghost-commute-empty', 'ghost', ['no employed residents in table 14']);
  const share60 = in60 / all;
  const share45 = in45 / all;
  const sensitivity = band / all;

  const method = [
    `ghost.shareCommuteWithin = share of the employed residents of the 41 districts (2020 census table 14) whose one-way time in the Commute_Matrix to the workplace district is at most ${t} minutes; the range low is the share at most ${t0} minutes and the range high equals the value.`,
    'Table 14 gives, for each residence district, the employed residents working in the same district, in another district of the same city, and in another county, city or overseas, and it gives no count by workplace district. Workplace districts are therefore estimated: residents working in the same district have time 0; residents working in another district of the same city are spread over the other districts of that city in proportion to commute.jobShare; residents working in another county, city or overseas are spread over the districts of the other city of the pair in proportion to commute.jobShare.',
    'Effect of the spreading, in both directions. (a) Setting commutes within one district to 0 minutes barely changes the share within the threshold, because commutes inside one district are under 45 minutes. (b) Placing the whole category of workers in another county, city or overseas into the other city of the pair raises the share within the threshold when the real destinations lie outside both cities (for example Linkou or Shulin to Taoyuan, and Xizhi to Keelung, are longer trips), so the Ghost counts derived from this share may be under-estimated.',
    'Commute times come from the modelled Commute_Matrix, and the census counts are for 2020 only.',
  ].join(' ');
  const sensMethod = [
    `ghost.sensitivityCommute = share of the same estimated workplace distribution whose time lies above ${t - 1} and at most ${t} minutes; it is the change of the share above ${t} minutes per 1 minute of commute time.`,
    'The workplace distribution is estimated as for ghost.shareCommuteWithin: same-district commutes count as 0 minutes, other districts of the same city and the other city of the pair are weighted by commute.jobShare. The placement of the category of workers in another county, city or overseas into the other city of the pair can shift mass across the threshold, so the Ghost counts derived from it may be under-estimated.',
  ].join(' ');

  const shareEntry: ScalarParameter = {
    kind: 'scalar',
    value: share60,
    unit: SHARE_COMMUTE_WITHIN_UNIT,
    status: 'secondary',
    range: { low: share45, high: share60, lowSource: CENSUS_WORKPLACE_CITATION, highSource: CENSUS_WORKPLACE_CITATION },
    source: CENSUS_WORKPLACE_CITATION,
    estimated: { method },
  };
  const sensEntry: ScalarParameter = {
    kind: 'scalar',
    value: sensitivity,
    unit: SENSITIVITY_COMMUTE_UNIT,
    status: 'secondary',
    source: CENSUS_WORKPLACE_CITATION,
    estimated: { method: sensMethod },
  };
  for (const [id, entry] of [[SHARE_COMMUTE_WITHIN_ID, shareEntry], [SENSITIVITY_COMMUTE_ID, sensEntry]] as const) {
    const issues = checkParameterEntry(id, entry);
    if (issues.length > 0) throw new DataError('ghost-entry-invalid', id, issues.map((i) => i.problem));
  }
  return { shareCommuteWithin: shareEntry, sensitivityCommute: sensEntry, within45: share45, within60: share60 };
}
