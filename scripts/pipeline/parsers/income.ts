/**
 * Parsers for the two income files (pure: text in, rows out).
 *
 * FIA comprehensive income tax by village (data.gov.tw 103066, one CSV per income year, `{103..112}_165-9.csv`):
 * the district total row is the row whose `村里` cell is `合計`. The first column holds the district name with its
 * city prefix (`臺北市松山區`) and is named `鄉鎮市區` up to ROC 109 and `縣市別` from ROC 110. `中位數` of that row
 * is the district median income in NT$ thousand: the `FIAmedian(d, y)` of the design. It is the median reported by
 * the FIA for all tax units of the district, not a median of village medians. Rows whose name matches none of the 41
 * districts are skipped. Same row selection as `districtTotals` in `scripts/sources/income.ts`, which cannot be
 * imported here because that module imports the HTTP helpers.
 *
 * DGBAS 9415 (`dgbas-9415-disposable-income-by-region.csv`): one row per Gregorian year from 1998. Columns used:
 * `年`, `臺北市-元`, `新北市-元` (NT$ per household per year).
 *
 * A missing required column throws `ParseError` (file, row 1, expected names, found names). A required cell that
 * is not a positive number throws `ParseError` with its row number.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { districtByZh } from '../../lib/districts.ts';
import { ParseError } from '../errors.ts';

export interface FiaDistrictRow {
  readonly districtCode: string;
  /** Gregorian income year the file covers (the caller derives it from the file name). */
  readonly incomeYear: number;
  /** Tax units (households) in the district total row. */
  readonly households: number;
  /** Median income of the district total row, NT$ thousand. */
  readonly median: number;
}

export interface DgbasCityIncomeRow {
  readonly year: number;
  /** Average disposable income per household, Taipei City, NT$ per year. */
  readonly taipei: number;
  /** Average disposable income per household, New Taipei City, NT$ per year. */
  readonly newTaipei: number;
}

/** Index of the first header cell equal to one of `names` after trimming, or -1. */
function indexOfAny(header: readonly string[], names: readonly string[]): number {
  return header.findIndex((h) => names.includes(h));
}

function positive(cell: string | undefined, column: string, file: string, row: number): number {
  const n = parseNumber(cell ?? '');
  if (!Number.isFinite(n) || n <= 0) {
    throw new ParseError(file, row, [`${column}: positive number`], [`${column}: ${JSON.stringify(cell ?? null)}`], `${column} is not a positive number`);
  }
  return n;
}

/** The district total rows (村里 = 合計) of one FIA file, for the districts among the 41 that appear in it. */
export function parseFiaDistrictTotals(text: string, file: string, incomeYear: number): FiaDistrictRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const nameCols = ['鄉鎮市區', '縣市別'];
  const nameCol = indexOfAny(header, nameCols);
  const villageCol = header.indexOf('村里');
  const unitsCol = header.indexOf('納稅單位(戶)');
  const medianCol = header.indexOf('中位數');
  if (nameCol < 0 || villageCol < 0 || unitsCol < 0 || medianCol < 0) {
    const expected = ['鄉鎮市區 or 縣市別', '村里', '納稅單位(戶)', '中位數'];
    const missing = [nameCol, villageCol, unitsCol, medianCol].findIndex((i) => i < 0);
    throw new ParseError(file, 1, expected, header, `missing required column ${expected[missing]}`);
  }
  const out: FiaDistrictRow[] = [];
  rows.forEach((r, i) => {
    if ((r[villageCol] ?? '').trim() !== '合計') return;
    const d = districtByZh((r[nameCol] ?? '').trim());
    if (!d) return;
    const row = i + 2;
    out.push({
      districtCode: d.code,
      incomeYear,
      households: positive(r[unitsCol], '納稅單位(戶)', file, row),
      median: positive(r[medianCol], '中位數', file, row),
    });
  });
  return out;
}

/** All rows of the DGBAS 9415 table with the two city columns, in file order. */
export function parseDgbasDisposableIncome(text: string, file: string): DgbasCityIncomeRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected = ['年', '臺北市-元', '新北市-元'];
  const idx = expected.map((n) => header.indexOf(n));
  const missing = idx.findIndex((i) => i < 0);
  if (missing >= 0) {
    throw new ParseError(file, 1, expected, header, `missing required column ${expected[missing]}`);
  }
  const [yearCol, taipeiCol, newTaipeiCol] = idx as [number, number, number];
  const out: DgbasCityIncomeRow[] = [];
  rows.forEach((r, i) => {
    if (r.length === 1 && (r[0] ?? '').trim() === '') return; // blank line
    const row = i + 2;
    const yearCell = (r[yearCol] ?? '').trim();
    if (!/^\d{4}$/.test(yearCell)) {
      throw new ParseError(file, row, ['年: four-digit year'], [`年: ${JSON.stringify(yearCell)}`], '年 is not a four-digit year');
    }
    out.push({
      year: Number(yearCell),
      taipei: positive(r[taipeiCol], '臺北市-元', file, row),
      newTaipei: positive(r[newTaipeiCol], '新北市-元', file, row),
    });
  });
  return out;
}

export interface FiaQuartileRow {
  readonly districtCode: string;
  readonly incomeYear: number;
  /** First quartile of the district total row, NT$ thousand. Any finite number: the caller checks the order. */
  readonly q1: number;
  /** Third quartile of the district total row, NT$ thousand. */
  readonly q3: number;
}

/**
 * Q1 and Q3 (`第一分位數`, `第三分位數`) of the district total rows of one FIA file, in file order.
 * Same row selection as `parseFiaDistrictTotals`. The quartiles are not required to be positive here:
 * Requirement 22.8 stops the build in `params/ghost.ts` with both values printed.
 */
export function parseFiaQuartiles(text: string, file: string, incomeYear: number): FiaQuartileRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const nameCol = indexOfAny(header, ['鄉鎮市區', '縣市別']);
  const villageCol = header.indexOf('村里');
  const q1Col = header.indexOf('第一分位數');
  const q3Col = header.indexOf('第三分位數');
  if (nameCol < 0 || villageCol < 0 || q1Col < 0 || q3Col < 0) {
    const expected = ['鄉鎮市區 or 縣市別', '村里', '第一分位數', '第三分位數'];
    const missing = [nameCol, villageCol, q1Col, q3Col].findIndex((i) => i < 0);
    throw new ParseError(file, 1, expected, header, `missing required column ${expected[missing]}`);
  }
  const out: FiaQuartileRow[] = [];
  rows.forEach((r, i) => {
    if ((r[villageCol] ?? '').trim() !== '合計') return;
    const d = districtByZh((r[nameCol] ?? '').trim());
    if (!d) return;
    const row = i + 2;
    const finite = (cell: string | undefined, column: string): number => {
      const n = parseNumber(cell ?? '');
      if (!Number.isFinite(n)) {
        throw new ParseError(file, row, [`${column}: number`], [`${column}: ${JSON.stringify(cell ?? null)}`], `${column} is not a number`);
      }
      return n;
    };
    out.push({ districtCode: d.code, incomeYear, q1: finite(r[q1Col], '第一分位數'), q3: finite(r[q3Col], '第三分位數') });
  });
  return out;
}
