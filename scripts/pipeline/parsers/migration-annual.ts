/**
 * Parsers for the two annual district migration tables that cover 2015-01..2015-11 (pure: text in, rows out).
 *
 * Taipei DBAS a05002802 (taipei-a05002802-cycle4.csv): one row per ROC year (`104年` = 2015). Each district has
 * a move-in column `社會增加/遷入人數/總計[人]/ <district>` and a move-out column
 * `社會增加/遷出人數/總計[人]/ <district>` (the district name has no 臺北市 prefix; whitespace after the last
 * slash is ignored). The `總計` city column and the `[含同區住址變更]` columns are not used.
 *
 * New Taipei 124872 (ntpc-124872.csv): unlabeled columns. `percent1` = Gregorian year, `percent2` = district name
 * without 新北市 and with a leading space (the city's own row is " 新北市"), `percent3` = move-in total,
 * `percent20` = move-out total. One row per district per year since 1998.
 *
 * Both parsers return the totals of ONE year (default 2015) for the districts present in the file:
 * `T2015(d)` of the design (the Migration section). They do not check that all districts are present; the
 * migration builder (task 5.2) does. A district name inside the file that matches no district of that city
 * throws `DataError`. A missing required column throws `ParseError` (file, row 1, expected names, found names).
 */
import { parseCsv } from '../../lib/csv.ts';
import { DISTRICTS, districtByZh } from '../../lib/districts.ts';
import { DataError, ParseError } from '../errors.ts';

export interface AnnualMigrationRow {
  readonly districtCode: string;
  readonly year: number;
  /** Total move-in persons for the year. */
  readonly moveIn: number;
  /** Total move-out persons for the year. */
  readonly moveOut: number;
}

function toCount(cell: string | undefined, column: string, file: string, row: number): number {
  const v = (cell ?? '').replace(/[,\s]/g, '');
  if (!/^\d+$/.test(v)) {
    throw new ParseError(file, row, [`${column}: non-negative integer`], [`${column}: ${JSON.stringify(cell ?? null)}`], `${column} is not a non-negative integer`);
  }
  return Number(v);
}

/** Removes every whitespace character, so "…/ 松山區" and "…/松山區" compare equal. */
const squash = (s: string) => s.replace(/\s+/g, '');

/** Taipei a05002802 annual move-in and move-out totals per district for `year` (Gregorian). */
export function parseTaipeiAnnualMigration(text: string, file: string, year = 2015): AnnualMigrationRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map(squash);
  const taipei = DISTRICTS.filter((d) => d.city === 'Taipei');
  const inName = (zh: string) => squash(`社會增加/遷入人數/總計[人]/${zh}`);
  const outName = (zh: string) => squash(`社會增加/遷出人數/總計[人]/${zh}`);
  const expected = ['統計期', ...taipei.flatMap((d) => [inName(d.zh.slice(3)), outName(d.zh.slice(3))])];
  const missing = expected.filter((n) => !header.includes(n));
  if (missing.length > 0) {
    throw new ParseError(file, 1, expected, header, `missing required column ${missing[0]}`);
  }
  const labelCol = header.indexOf('統計期');
  const label = `${year - 1911}年`;
  const at = rows.findIndex((r) => squash(r[labelCol] ?? '') === label);
  if (at < 0) {
    throw new ParseError(file, undefined, [`統計期 = ${label}`], rows.map((r) => r[labelCol] ?? ''), `no row for ${label}`);
  }
  const row = rows[at]!;
  const rowNumber = at + 2;
  return taipei.map((d) => {
    const zh = d.zh.slice(3);
    return {
      districtCode: d.code,
      year,
      moveIn: toCount(row[header.indexOf(inName(zh))], inName(zh), file, rowNumber),
      moveOut: toCount(row[header.indexOf(outName(zh))], outName(zh), file, rowNumber),
    };
  });
}

const NTPC_EXPECTED = ['percent1', 'percent2', 'percent3', 'percent20'];

/** New Taipei 124872 annual move-in (percent3) and move-out (percent20) totals per district for `year` (Gregorian). */
export function parseNewTaipeiAnnualMigration(text: string, file: string, year = 2015): AnnualMigrationRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const idx = Object.fromEntries(NTPC_EXPECTED.map((n) => [n, header.indexOf(n)])) as Record<string, number>;
  const missing = NTPC_EXPECTED.filter((n) => idx[n]! < 0);
  if (missing.length > 0) {
    throw new ParseError(file, 1, NTPC_EXPECTED, header, `missing required column ${missing[0]}`);
  }
  const out: AnnualMigrationRow[] = [];
  rows.forEach((r, i) => {
    if ((r[idx['percent1']!] ?? '').trim() !== String(year)) return;
    const row = i + 2;
    const name = (r[idx['percent2']!] ?? '').trim();
    if (name === '新北市') return; // city total row
    const d = districtByZh(`新北市${name}`);
    if (!d) throw new DataError('unmatched-district', `${file} row ${row}`, [`value: ${name}`]);
    out.push({
      districtCode: d.code,
      year,
      moveIn: toCount(r[idx['percent3']!], 'percent3', file, row),
      moveOut: toCount(r[idx['percent20']!], 'percent20', file, row),
    });
  });
  return out;
}
