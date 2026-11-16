/**
 * Parsers for the two Taipei Metro ridership sources (pure: decoded text in, rows out).
 *
 * Annual series (data.gov.tw 133184, `mrt/taipei-133184-annual-station.csv`, UTF-8):
 *   columns `統計期` (ROC year such as `103年`), `捷運站別` (row name, with a line suffix for transfer
 *   stations, e.g. `板橋Y`, `南京復興BR`), `進站人次` (entries, plain integer or with thousands separators).
 *   Other columns (`出站人次`, change rates) are ignored. Every row is returned, including the non-station
 *   rows (`一日票`, `團體票`, `其他`); the caller filters them with `NON_STATION_ROWS`.
 *   The year is the ROC year plus 1911.
 *
 * Daily entries (data.gov.tw 128683, `mrt/daily/taipei-entries-YYYY-MM.csv`, Big5):
 *   the CALLER decodes the bytes with `reader.readText(path, 'big5')` and passes the text. The first column
 *   `日期` holds `YYYY/M/D`; every other column is one station and its header is the station name as used in
 *   that file. Station names in these files carry no line suffix (`南京復興`, `板橋`), so one column covers a
 *   transfer station for all of its lines. The set of columns differs between files (for example `頂埔`
 *   appears from 2015-07), so entries are returned as a map keyed by the header of each file. Cells hold
 *   integers with thousands separators and sometimes a trailing space (`"5,782 "`).
 *
 * Any missing required column, duplicate station column, short row or non-numeric cell throws `ParseError`
 * (file, row, expected, found).
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { rocToAd } from '../../lib/time.ts';
import { ParseError } from '../errors.ts';

export interface MrtAnnualRow {
  /** Gregorian year (ROC year + 1911). */
  readonly year: number;
  /** Row name exactly as in the annual series, e.g. "板橋Y". */
  readonly name: string;
  /** Entries (進站人次) for the year. */
  readonly entries: number;
}

export interface MrtDailyRow {
  /** ISO date, e.g. "2015-01-01". */
  readonly date: string;
  /** Entries per station column header of the file (no line suffix). Insertion order follows the header. */
  readonly entries: ReadonlyMap<string, number>;
}

const ANNUAL_COLUMNS = { period: '統計期', name: '捷運站別', entries: '進站人次' } as const;
const DAILY_DATE_COLUMN = '日期';

function isBlank(cells: readonly string[]): boolean {
  return cells.length === 0 || (cells.length === 1 && (cells[0] ?? '').trim() === '');
}

/** Annual entries per row name and year (all rows, in file order). */
export function parseMrtAnnual(text: string, file: string): MrtAnnualRow[] {
  const [header, ...rest] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = (header ?? []).map((h) => h.trim());
  const expected = Object.values(ANNUAL_COLUMNS);
  const idx = {
    period: names.indexOf(ANNUAL_COLUMNS.period),
    name: names.indexOf(ANNUAL_COLUMNS.name),
    entries: names.indexOf(ANNUAL_COLUMNS.entries),
  };
  for (const key of Object.keys(ANNUAL_COLUMNS) as (keyof typeof ANNUAL_COLUMNS)[]) {
    if (idx[key] < 0) throw new ParseError(file, 1, expected, names, `missing required column ${ANNUAL_COLUMNS[key]}`);
  }
  const rows: MrtAnnualRow[] = [];
  const seen = new Set<string>();
  rest.forEach((cells, i) => {
    const row = i + 2;
    if (isBlank(cells)) return;
    const cell = (key: keyof typeof ANNUAL_COLUMNS): string => {
      const v = cells[idx[key]];
      if (v === undefined) throw new ParseError(file, row, expected, names, `row has no value for ${ANNUAL_COLUMNS[key]}`);
      return v.trim();
    };
    const period = cell('period');
    const m = /^(\d{2,3})年$/.exec(period);
    if (!m) {
      throw new ParseError(file, row, [`${ANNUAL_COLUMNS.period}: ROC "yyy年"`], [`${ANNUAL_COLUMNS.period}: ${JSON.stringify(period)}`], 'period is not an ROC year');
    }
    const name = cell('name');
    if (name === '') {
      throw new ParseError(file, row, [`${ANNUAL_COLUMNS.name}: non-empty`], [`${ANNUAL_COLUMNS.name}: ""`], 'empty row name');
    }
    const raw = cell('entries');
    const entries = parseNumber(raw);
    if (!Number.isInteger(entries) || entries < 0) {
      throw new ParseError(file, row, [`${ANNUAL_COLUMNS.entries}: non-negative integer`], [`${ANNUAL_COLUMNS.entries}: ${JSON.stringify(raw)}`], 'entries is not a non-negative integer');
    }
    const year = rocToAd(Number(m[1]));
    const key = `${year}\u0000${name}`;
    if (seen.has(key)) {
      throw new ParseError(file, row, ['one row per year and name'], [`duplicate ${JSON.stringify(name)} in ${year}`], 'duplicate row');
    }
    seen.add(key);
    rows.push({ year, name, entries });
  });
  return rows;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Daily entries per station column of one monthly file (rows in file order). */
export function parseMrtDailyEntries(text: string, file: string): MrtDailyRow[] {
  const [header, ...rest] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = (header ?? []).map((h) => h.trim());
  const expected = [DAILY_DATE_COLUMN, '<station name>…'];
  const dateIdx = names.indexOf(DAILY_DATE_COLUMN);
  if (dateIdx < 0) throw new ParseError(file, 1, expected, names, `missing required column ${DAILY_DATE_COLUMN}`);
  const stationCols: { readonly name: string; readonly index: number }[] = [];
  const seenNames = new Set<string>();
  names.forEach((n, index) => {
    if (index === dateIdx || n === '') return;
    if (seenNames.has(n)) throw new ParseError(file, 1, expected, names, `duplicate station column ${n}`);
    seenNames.add(n);
    stationCols.push({ name: n, index });
  });
  if (stationCols.length === 0) throw new ParseError(file, 1, expected, names, 'no station columns');

  const rows: MrtDailyRow[] = [];
  const seenDates = new Set<string>();
  rest.forEach((cells, i) => {
    const row = i + 2;
    if (isBlank(cells)) return;
    const rawDate = (cells[dateIdx] ?? '').trim();
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(rawDate);
    const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    const valid = m !== null && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (!valid) {
      throw new ParseError(file, row, [`${DAILY_DATE_COLUMN}: YYYY/M/D`], [`${DAILY_DATE_COLUMN}: ${JSON.stringify(rawDate)}`], 'date is not YYYY/M/D');
    }
    const date = `${y}-${pad2(mo)}-${pad2(d)}`;
    if (seenDates.has(date)) {
      throw new ParseError(file, row, ['one row per date'], [`duplicate date ${date}`], 'duplicate date');
    }
    seenDates.add(date);
    const entries = new Map<string, number>();
    for (const col of stationCols) {
      const raw = cells[col.index];
      if (raw === undefined) {
        throw new ParseError(file, row, [`${col.name}: integer`], [`row has ${cells.length} cells, header has ${names.length}`], `row has no value for ${col.name}`);
      }
      const n = parseNumber(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new ParseError(file, row, [`${col.name}: non-negative integer`], [`${col.name}: ${JSON.stringify(raw)}`], 'entries is not a non-negative integer');
      }
      entries.set(col.name, n);
    }
    rows.push({ date, entries });
  });
  return rows;
}
