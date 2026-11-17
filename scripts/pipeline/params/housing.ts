/**
 * Housing derivation parameters (Requirements 22.5, 22.6, 22.12):
 *
 *   housing.dwellingSize            = median 建物總面積平方公尺 of the qualifying rental records, 2015Q1..2025Q4, both cities
 *   housing.householdSize.<city>    = Σ people_total ÷ Σ household_no over the village rows of the city, ODRP014 of 2020-12
 *   housing.renterRate.<city>       = renting households ÷ households of the city, 2020 census table 34
 *
 * Status `verified` with an `estimated.method`. The pure builders take parsed rows; `loadHousingParams`
 * reads them through the build context.
 */
import { DISTRICTS, type City } from '../../lib/districts.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { BuildContext } from '../context.ts';
import { DataError, ParseError } from '../errors.ts';
import { lvrPaths } from '../indicators/lvr-input.ts';
import { median } from '../numeric.ts';
import { parseCensusTenureOds, type CityTenure } from '../parsers/census-tenure.ts';
import { dedupeRentals, parseRentalExtras, splitWholeDwellings, type RentalRecord } from '../parsers/lvr-rental-extra.ts';

export const CITIES: readonly City[] = ['Taipei', 'New Taipei'];

/** ODRP014 month used for the household size: December 2020 (ROC 109/12). */
export const HOUSEHOLD_MONTH = '10912';

export const ODRP014_COUNTY: Readonly<Record<City, string>> = { Taipei: '臺北市', 'New Taipei': '新北市' };
export const ODRP014_PATH = (city: City): string => `population/ris/ODRP014-${HOUSEHOLD_MONTH}-${ODRP014_COUNTY[city]}.json`;
export const TENURE_PATH: Readonly<Record<City, string>> = {
  Taipei: 'census/census2020-taipei-s034-tenure.ods',
  'New Taipei': 'census/census2020-ntpc-s034-tenure.ods',
};

export const DWELLING_SIZE_UNIT = 'm² per rented dwelling';
export const HOUSEHOLD_SIZE_UNIT = 'persons per household';
export const RENTER_RATE_UNIT = 'share of households';

const LVR_SOURCE = {
  citation: 'MOI Department of Land Administration, real-price registration rental records (data.gov.tw 25118)',
  url: 'https://data.gov.tw/dataset/25118',
};
const ODRP014_SOURCE = {
  citation: 'MOI Department of Household Registration, ODRP014 households and population by village, December 2020',
  url: 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014',
};
const CENSUS_URL: Readonly<Record<City, string>> = {
  Taipei: 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230887/s034.ods',
  'New Taipei': 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230886/s034.ods',
};
const censusSource = (city: City) => ({
  citation: `DGBAS 2020 Population and Housing Census, table 34 (home ownership of ordinary households), ${city}`,
  url: CENSUS_URL[city],
});

/** Text of the single-year note (Requirement 22.6); the Sources_Document step also states it. */
export const RENTER_RATE_NOTE = 'The renter rate is a single-year value (census of November 2020) and is used as a constant for all quarters.';

export const dwellingSizeId = 'housing.dwellingSize';
export const householdSizeId = (city: City): string => `housing.householdSize.${city}`;
export const renterRateId = (city: City): string => `housing.renterRate.${city}`;

export interface HouseholdTotals {
  readonly households: number;
  readonly people: number;
}

export interface HousingInputs {
  /** De-duplicated rental records (any of them; the qualifying filter is applied here). */
  readonly rentals: readonly RentalRecord[];
  readonly householdTotals: Readonly<Record<City, HouseholdTotals>>;
  readonly tenure: Readonly<Record<City, CityTenure>>;
}

export interface HousingResult {
  readonly entries: ReadonlyMap<string, ScalarParameter>;
  /** Counts behind each value, for the build log. */
  readonly counts: {
    readonly rentalRecords: number;
    readonly rentalFilter: {
      readonly qualifying: number;
      readonly kept: number;
      readonly excluded: Readonly<Record<'parking' | 'suite-or-room' | 'other-type', number>>;
    };
    /** Report only: never used to adjust a value. */
    readonly rentCrossCheck: Readonly<Record<City, RentCrossCheck>>;
    readonly householdTotals: Readonly<Record<City, HouseholdTotals>>;
    readonly tenure: Readonly<Record<City, { households: number; renting: number }>>;
  };
}

/**
 * Σ people_total and Σ household_no over the village rows of one city from an ODRP014 JSON file.
 * Rows are mapped to districts by the first 8 digits of `district_code`; rows of another city, an unknown
 * district, a month other than `expectedMonth` or a count that is not a non-negative integer stop the build.
 */
export function parseHouseholdTotals(text: string, file: string, city: City, expectedMonth: string = HOUSEHOLD_MONTH): HouseholdTotals {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new ParseError(file, 1, ['a JSON array of records'], ['text that is not valid JSON'], 'invalid JSON');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new ParseError(file, 1, ['a non-empty JSON array of records'], [Array.isArray(data) ? 'empty array' : typeof data], 'unexpected JSON shape');
  }
  const codes = new Set(DISTRICTS.filter((d) => d.city === city).map((d) => d.code));
  const expected = ['statistic_yyymm', 'district_code', 'household_no', 'people_total'];
  let households = 0;
  let people = 0;
  (data as unknown[]).forEach((rec, i) => {
    const row = i + 1;
    const r = (typeof rec === 'object' && rec !== null ? rec : {}) as Record<string, unknown>;
    const cells = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('\uFEFF', ''), v]));
    const found = Object.keys(cells);
    const get = (k: string): string => String(cells[k] ?? '').trim();
    for (const k of expected) if (cells[k] === undefined || cells[k] === null) throw new ParseError(file, row, expected, found, `missing ${k}`);
    if (get('statistic_yyymm') !== expectedMonth) {
      throw new ParseError(file, row, [`statistic_yyymm: ${expectedMonth}`], [`statistic_yyymm: ${get('statistic_yyymm')}`], 'month is not the expected month');
    }
    const district = get('district_code').slice(0, 8);
    if (!codes.has(district)) throw new DataError('unmatched-district', `${file} row ${row}`, [`district_code: ${get('district_code')}`, `city: ${city}`]);
    for (const k of ['household_no', 'people_total']) {
      if (!/^\d+$/.test(get(k))) throw new ParseError(file, row, [`${k}: non-negative integer`], [`${k}: ${JSON.stringify(cells[k])}`], `${k} is not a non-negative integer`);
    }
    households += Number(get('household_no'));
    people += Number(get('people_total'));
  });
  if (households <= 0 || people <= 0) throw new DataError('empty household totals', file, [`city: ${city}`, `households: ${households}`, `people: ${people}`]);
  return { households, people };
}

function entry(value: number, unit: string, source: { citation: string; url: string }, method: string): ScalarParameter {
  return { kind: 'scalar', value, unit, source, status: 'verified', estimated: { method } };
}

export interface RentCrossCheck {
  readonly records: number;
  /** District median rent per m² × dwelling size, weighted by each district's record count (NT$ per month). */
  readonly areaBasedRent: number;
  /** Median monthly total rent of the city's records (NT$ per month). */
  readonly medianTotalRent: number;
  /** (areaBasedRent − medianTotalRent) ÷ medianTotalRent × 100. */
  readonly gapPercent: number;
}

/** Report-only cross-check per city on the filtered records. Adjusts nothing. */
export function rentCrossCheck(kept: readonly RentalRecord[], dwellingSize: number): Record<City, RentCrossCheck> {
  const out = {} as Record<City, RentCrossCheck>;
  for (const city of CITIES) {
    const codes = new Set(DISTRICTS.filter((d) => d.city === city).map((d) => d.code));
    const rows = kept.filter((r) => r.districtCode !== undefined && codes.has(r.districtCode));
    const byDistrict = new Map<string, number[]>();
    for (const r of rows) {
      const list = byDistrict.get(r.districtCode as string) ?? [];
      list.push(r.rent / r.area);
      byDistrict.set(r.districtCode as string, list);
    }
    let weighted = 0;
    for (const list of byDistrict.values()) weighted += list.length * median(list) * dwellingSize;
    const areaBasedRent = weighted / rows.length;
    const medianTotalRent = median(rows.map((r) => r.rent));
    out[city] = { records: rows.length, areaBasedRent, medianTotalRent, gapPercent: ((areaBasedRent - medianTotalRent) / medianTotalRent) * 100 };
  }
  return out;
}

/** Builds the five entries and checks each one with `checkParameterEntry`. */
export function buildHousingParams(input: HousingInputs): HousingResult {
  const split = splitWholeDwellings(input.rentals);
  const areas = split.kept.map((r) => r.area);
  if (areas.length === 0) throw new DataError('no qualifying rental records', 'housing.dwellingSize', ['qualifying rental records: 0']);
  const dwellingSize = median(areas);
  const ex = split.excluded;
  const excludedTotal = ex.parking + ex['suite-or-room'] + ex['other-type'];

  const entries = new Map<string, ScalarParameter>();
  entries.set(
    dwellingSizeId,
    entry(
      dwellingSize,
      DWELLING_SIZE_UNIT,
      LVR_SOURCE,
      `Median 建物總面積平方公尺 of whole-dwelling rental records, lease date 2015Q1 to 2025Q4, Taipei and New Taipei together, ` +
        `duplicates by 編號 removed. Filters: 主要用途 contains 住家用 or 住宅; rent and area above 0; keep 出租型態 blank or 整棟(戶)出租; ` +
        `exclude records with a parking space (車位N above 0 in 租賃筆棟數, or 交易標的 containing 車位) and 出租型態 ` +
        `獨立套房, 分租套房, 分租雅房 or 分層出租. Records: ${split.qualifying.length} qualifying (residential, valid, rent and area above 0), ` +
        `${areas.length} kept, ${excludedTotal} excluded (parking ${ex.parking}; suite, room or floor-share types ${ex['suite-or-room']}` +
        `${ex['other-type'] > 0 ? `; other types ${ex['other-type']}` : ''}). ` +
        `Reason: the Ghost rule compares household income with the rent of a reference dwelling, which should be a whole dwelling rented by a household. ` +
        `Area and rent per m² both use the building total area including shared space, so rent per m² × area equals the actual monthly rent. ` +
        `Blank-type records before 2023 may include suites that cannot be identified. Suite and room renters are not included in the reference dwelling.`,
    ),
  );
  const tenureCounts = {} as Record<City, { households: number; renting: number }>;
  for (const city of CITIES) {
    const t = input.householdTotals[city];
    entries.set(
      householdSizeId(city),
      entry(
        t.people / t.households,
        HOUSEHOLD_SIZE_UNIT,
        ODRP014_SOURCE,
        `Σ people_total (${t.people}) ÷ Σ household_no (${t.households}) over the village rows of ${city} in the ODRP014 file of 2020-12. Constant for all quarters.`,
      ),
    );
    const c = input.tenure[city].total;
    tenureCounts[city] = { households: c.households, renting: c.renting };
    entries.set(
      renterRateId(city),
      entry(
        c.renting / c.households,
        RENTER_RATE_UNIT,
        censusSource(city),
        `Renting households (${c.renting}) ÷ ordinary households living in housing units (${c.households}) of ${city}, ` +
          `2020 census table 34 (November 2020). ${RENTER_RATE_NOTE}`,
      ),
    );
  }

  for (const [id, e] of entries) {
    const issues = checkParameterEntry(id, e);
    if (issues.length > 0) throw new DataError('parameter entry check failed', id, issues.map((i) => i.problem));
  }
  return { entries, counts: {
      rentalRecords: areas.length,
      rentalFilter: { qualifying: split.qualifying.length, kept: areas.length, excluded: ex },
      rentCrossCheck: rentCrossCheck(split.kept, dwellingSize),
      householdTotals: input.householdTotals, tenure: tenureCounts } };
}

/** Reads the raw inputs through the context and builds the entries. Does not write any file. */
export function loadHousingParams(ctx: BuildContext): HousingResult {
  const missing = [...CITIES.map(ODRP014_PATH), ...Object.values(TENURE_PATH)].filter((p) => !ctx.reader.exists(p));
  if (missing.length > 0) {
    throw new DataError('missing input files', 'housing params', missing.map((p) => `data/raw/${p}`));
  }
  const rentals = dedupeRentals(
    lvrPaths('rental').map((p) => {
      const display = ctx.reader.display(p);
      return { file: display, records: parseRentalExtras(ctx.reader.readText(p), display) };
    }),
  );
  const householdTotals = {} as Record<City, HouseholdTotals>;
  const tenure = {} as Record<City, CityTenure>;
  for (const city of CITIES) {
    const p = ODRP014_PATH(city);
    householdTotals[city] = parseHouseholdTotals(ctx.reader.readText(p), ctx.reader.display(p), city);
    const t = TENURE_PATH[city];
    tenure[city] = parseCensusTenureOds(ctx.reader.readBytes(t), ctx.reader.display(t), city);
  }
  return buildHousingParams({ rentals, householdTotals, tenure });
}
