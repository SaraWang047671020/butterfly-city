/**
 * Parser for the 2020 DGBAS Population and Housing Census, table 34 (ordinary households by home
 * ownership), one ODS file per city (Requirement 22.6).
 *
 *   data/raw/census/census2020-taipei-s034-tenure.ods
 *   data/raw/census/census2020-ntpc-s034-tenure.ods
 *
 * Layout (found by content, not by position): a header row containing 租用, then the city row and one row
 * per district. Every data row is `[name, total, self-owned, owned by family, rented, allotted or other, English name]`
 * with thousands separated by spaces ("933 940"). Households are counted at November 2020.
 *
 * Checks (each failure throws): the header cell 租用 exists; every row has five integer counts; the total of
 * each row equals the sum of its four categories; all districts of the city appear once; the district rows
 * sum to the printed city row.
 */
import { readOdsRows } from '../../lib/zip.ts';
import { DISTRICTS, districtByZh, type City } from '../../lib/districts.ts';
import { DataError, ParseError } from '../errors.ts';

export interface TenureRow {
  /** Ordinary households living in housing units. */
  readonly households: number;
  /** Households that rent (租用). */
  readonly renting: number;
}

export interface CityTenure {
  readonly city: City;
  /** The printed city row. */
  readonly total: TenureRow;
  /** District rows keyed by District_Code. */
  readonly districts: ReadonlyMap<string, TenureRow>;
}

const CITY_ZH: Readonly<Record<City, string>> = { Taipei: '臺北市', 'New Taipei': '新北市' };

function count(cell: string | undefined): number | undefined {
  const s = (cell ?? '').replace(/\s/g, '');
  return /^\d+$/.test(s) ? Number(s) : undefined;
}

/** Parses the rows of one table-34 sheet (as returned by `readOdsRows`) for the given city. */
export function parseCensusTenureRows(rows: readonly (readonly string[])[], file: string, city: City): CityTenure {
  const expected = ['header cell 租用', 'rows: name, total, self-owned, family-owned, rented, other, English name'];
  if (!rows.some((r) => r.includes('租用'))) {
    throw new ParseError(file, undefined, expected, rows.slice(0, 8).map((r) => r.join('|')), 'no header cell 租用');
  }
  const cityZh = CITY_ZH[city];
  let total: TenureRow | undefined;
  const districts = new Map<string, TenureRow>();

  rows.forEach((r, i) => {
    const name = r[0] ?? '';
    const isCity = name === cityZh;
    const district = isCity ? undefined : districtByZh(cityZh + name);
    if (!isCity && district === undefined) return;
    const nums = r.slice(1, 6).map(count);
    if (r.length < 6 || nums.some((n) => n === undefined)) {
      throw new ParseError(file, i + 1, expected, r, `row ${name} does not have five integer counts`);
    }
    const [all, self, family, rented, other] = nums as number[] as [number, number, number, number, number];
    if (self + family + rented + other !== all) {
      throw new DataError('tenure row total mismatch', `${file} row ${i + 1}`, [`row: ${name}`, `total: ${all}`, `sum of categories: ${self + family + rented + other}`]);
    }
    const value: TenureRow = { households: all, renting: rented };
    if (isCity) {
      if (total !== undefined) throw new DataError('duplicate city row', `${file} row ${i + 1}`, [`row: ${name}`]);
      total = value;
    } else {
      if (districts.has(district!.code)) throw new DataError('duplicate district row', `${file} row ${i + 1}`, [`row: ${name}`]);
      districts.set(district!.code, value);
    }
  });

  if (total === undefined) throw new DataError('missing city row', file, [`expected row: ${cityZh}`]);
  const missing = DISTRICTS.filter((d) => d.city === city && !districts.has(d.code)).map((d) => d.code);
  if (missing.length > 0) throw new DataError('missing district rows', file, [`city: ${city}`, `missing: ${missing.join(', ')}`]);

  let households = 0;
  let renting = 0;
  for (const d of districts.values()) {
    households += d.households;
    renting += d.renting;
  }
  if (households !== total.households || renting !== total.renting) {
    throw new DataError('tenure city total mismatch', file, [
      `city: ${city}`,
      `households: districts ${households}, printed ${total.households}`,
      `renting: districts ${renting}, printed ${total.renting}`,
    ]);
  }
  return { city, total, districts };
}

/** Reads one table-34 ODS file. */
export function parseCensusTenureOds(bytes: Buffer, file: string, city: City): CityTenure {
  let rows: string[][];
  try {
    rows = readOdsRows(bytes);
  } catch (e) {
    throw new ParseError(file, undefined, ['an ODS file with content.xml'], ['unreadable file'], (e as Error).message);
  }
  return parseCensusTenureRows(rows, file, city);
}
