/**
 * Parsers for the NLMA social housing portal files (pure: decoded text in, records out).
 *
 * Project list (`social-housing/nlma-portal-GetScheduleData-{A,F}.json`; A = Taipei, F = New Taipei):
 *   `{ Data: { data: [ { setupplan_guid, city_name, execute_status_description, household_num,
 *   strStartDate, strEndDate, ... } ] } }`. `household_num` is a string. Dates are ROC `yyy/mm/dd` text,
 *   or an empty string when the portal has no date. Status `已完工` means completed.
 *
 * Project detail (`social-housing/nlma-portal-dashboard/{guid}.json`):
 *   `{ d: { Data: { SetupplanGuid, CityCode, TownCode, ... } } }`. `CityCode` is the portal letter (A or F)
 *   and `TownCode` is the portal's own two-digit district code (for example `17`), not the 8-digit MOI code.
 *
 * A missing field or a field of the wrong type throws `ParseError`. A `household_num` that is not a string of
 * ASCII digits (a non-negative integer) throws `DataError` naming the guid, the file and the value
 * (Requirement 13.6).
 */
import { DataError, ParseError } from '../errors.ts';

/** Status text of a completed project. */
export const STATUS_COMPLETED = '已完工';

export type PortalCityName = 'Taipei' | 'New Taipei';

export interface SocialHousingProject {
  /** `setupplan_guid`, as written in the list. */
  readonly guid: string;
  /** `execute_status_description`, for example `已完工` or `興建中`. */
  readonly status: string;
  /** `household_num`, validated as a non-negative integer. */
  readonly householdNum: number;
  /** `strStartDate` as written (ROC `yyy/mm/dd`), or an empty string. */
  readonly strStartDate: string;
  /** `strEndDate` as written (ROC `yyy/mm/dd`), or an empty string. */
  readonly strEndDate: string;
  /** City from `city_name`; undefined when the list has another or no city name. */
  readonly city: PortalCityName | undefined;
  /** Repository-relative display path of the list file the project came from. */
  readonly file: string;
}

export interface SocialHousingDetail {
  readonly guid: string;
  /** Portal city letter (`A` or `F`), or an empty string when the detail has none. */
  readonly cityCode: string;
  /** Portal district code as written (for example `17`). */
  readonly townCode: string;
}

const LIST_COLUMNS = [
  'setupplan_guid',
  'execute_status_description',
  'household_num',
  'strStartDate',
  'strEndDate',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, file: string, expected: readonly string[]): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new ParseError(file, undefined, expected, [], `not valid JSON (${(error as Error).message})`);
  }
}

/** A string of ASCII digits within the safe integer range. */
export function parseHouseholdNum(value: string, guid: string, file: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n)) {
    throw new DataError('invalid-household-num', guid, [`file: ${file}`, `setupplan_guid: ${guid}`, `household_num: ${JSON.stringify(value)}`]);
  }
  return n;
}

function cityOf(name: unknown): PortalCityName | undefined {
  if (name === '臺北市' || name === '台北市') return 'Taipei';
  if (name === '新北市') return 'New Taipei';
  return undefined;
}

/** Projects of one list file, in file order. */
export function parseScheduleList(text: string, file: string): SocialHousingProject[] {
  const root = parseJson(text, file, ['Data.data']);
  const data = isRecord(root) && isRecord(root['Data']) ? root['Data']['data'] : undefined;
  if (!Array.isArray(data)) {
    throw new ParseError(file, undefined, ['Data.data (array of projects)'], isRecord(root) ? Object.keys(root) : [typeof root], 'missing Data.data array');
  }
  const rows: unknown[] = data;
  return rows.map((raw, i): SocialHousingProject => {
    const row = i + 1;
    if (!isRecord(raw)) throw new ParseError(file, row, LIST_COLUMNS, [typeof raw], 'project is not an object');
    const found = Object.keys(raw);
    const field = (key: (typeof LIST_COLUMNS)[number]): string => {
      const v = raw[key];
      if (typeof v !== 'string') throw new ParseError(file, row, LIST_COLUMNS, found, `missing or non-text field ${key}`);
      return v;
    };
    const guid = field('setupplan_guid').trim();
    if (guid === '') throw new ParseError(file, row, LIST_COLUMNS, found, 'empty setupplan_guid');
    return {
      guid,
      status: field('execute_status_description').trim(),
      householdNum: parseHouseholdNum(field('household_num').trim(), guid, file),
      strStartDate: field('strStartDate').trim(),
      strEndDate: field('strEndDate').trim(),
      city: cityOf(raw['city_name']),
      file,
    };
  });
}

/** The detail record of one project. */
export function parseProjectDetail(text: string, file: string): SocialHousingDetail {
  const expected = ['d.Data.SetupplanGuid', 'd.Data.TownCode'];
  const root = parseJson(text, file, expected);
  const d = isRecord(root) ? root['d'] : undefined;
  const data = isRecord(d) ? d['Data'] : undefined;
  if (!isRecord(data)) {
    throw new ParseError(file, undefined, expected, isRecord(root) ? Object.keys(root) : [typeof root], 'missing d.Data object');
  }
  const found = Object.keys(data);
  const guid = data['SetupplanGuid'];
  const townCode = data['TownCode'];
  const cityCode = data['CityCode'];
  if (typeof guid !== 'string' || guid.trim() === '') throw new ParseError(file, undefined, expected, found, 'missing SetupplanGuid');
  if (typeof townCode !== 'string') throw new ParseError(file, undefined, expected, found, 'missing or non-text TownCode');
  return {
    guid: guid.trim(),
    cityCode: typeof cityCode === 'string' ? cityCode.trim() : '',
    townCode: townCode.trim(),
  };
}

export interface RocSlashDate {
  /** Gregorian year (ROC year + 1911). */
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** Quarter number 1..4. */
  readonly quarter: 1 | 2 | 3 | 4;
}

/** Parses ROC `yyy/mm/dd` (also `yy/m/d`) with a real calendar check; undefined when empty or malformed. */
export function parseRocSlashDate(value: string): RocSlashDate | undefined {
  const m = /^(\d{1,3})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (m === null) return undefined;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return undefined;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return undefined;
  return { year, month, day, quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4 };
}
