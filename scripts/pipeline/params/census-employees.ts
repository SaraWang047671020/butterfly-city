/**
 * Reader and totals check of the 2021 DGBAS Industry and Service Census employee tables (Requirement 28).
 *
 *   data/config/census-employees-2021.csv         district_code,employees,source_url,table_id,page
 *   data/config/census-employees-2021-totals.csv  city,employees,source_url,table_id,page
 *
 * Both tables were transcribed by hand from table 10 (page 140) of the 110年臺北市工業及服務業普查報告 and
 * 110年新北市工業及服務業普查報告. No PDF is read by the pipeline.
 *
 * Concept: the column is named `employees`, but the census figure is 從業員工人數 (persons engaged at the
 * end of 2021): paid employees plus owners and unpaid family workers. The census covers industry and
 * service establishments; it excludes government agencies, schools and the armed forces.
 *
 * Pure: text in, rows out. Each failed check throws `DataError`; a missing column throws `ParseError`.
 */
import { parseCsv } from '../../lib/csv.ts';
import { DISTRICTS, type City } from '../../lib/districts.ts';
import type { BuildContext } from '../context.ts';
import { DataError, ParseError } from '../errors.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';
import type { BuildState, Step } from '../run.ts';

export const CENSUS_EMPLOYEES_TABLE = 'data/config/census-employees-2021.csv';
export const CENSUS_TOTALS_TABLE = 'data/config/census-employees-2021-totals.csv';

export const CENSUS_EMPLOYEE_COLUMNS: readonly string[] = ['district_code', 'employees', 'source_url', 'table_id', 'page'];
export const CENSUS_TOTAL_COLUMNS: readonly string[] = ['city', 'employees', 'source_url', 'table_id', 'page'];

export interface CensusEmployeeRow {
  readonly row: number;
  readonly districtCode: string;
  /** Persons engaged (從業員工人數) at the end of 2021. */
  readonly employees: number;
  readonly sourceUrl: string;
  readonly tableId: string;
  readonly page: number;
}

export interface CensusTotalRow {
  readonly row: number;
  readonly city: City;
  readonly employees: number;
  readonly sourceUrl: string;
  readonly tableId: string;
  readonly page: number;
}

/**
 * Text for `estimated.method` of each `commute.jobShare.<code>` entry (Requirement 28.6). The params step
 * (task 25) reads it from here.
 */
export const JOB_SHARE_METHOD_TEXT =
  'District share of the 2021 DGBAS Industry and Service Census count of persons engaged (從業員工人數, table 10, ' +
  'owners and unpaid family workers included), divided by the total of the 41 districts. The census excludes ' +
  'government agencies, schools and the armed forces, so districts where public employers concentrate (for ' +
  'example Zhongzheng) are under-counted.';

/** Explanatory note for SOURCES.md (task 26 renders it; it is never used in a test). */
export const CENSUS_PRESS_RELEASE_NOTE =
  'The DGBAS press release published earlier gives 1,888,029 persons engaged for Taipei City and 1,413,606 for ' +
  'New Taipei City. The tables use the totals printed in the census reports (1,885,704 and 1,415,275, table 10, ' +
  'page 140), because the district rows sum to those figures.';

function fail(file: string, row: number, reason: string): never {
  throw new DataError(`row check failed (${reason})`, `${file} row ${row}`, [`table: ${file}`, `row: ${row}`, `reason: ${reason}`]);
}

interface RawRow {
  readonly row: number;
  readonly cells: Record<string, string>;
}

function readRows(text: string, file: string, columns: readonly string[]): RawRow[] {
  const [rawHeader, ...rest] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const missing = columns.find((c) => !header.includes(c));
  if (missing !== undefined) throw new ParseError(file, 1, columns, header, `missing required column ${missing}`);
  const rows: RawRow[] = [];
  rest.forEach((r, i) => {
    if (r.length === 1 && (r[0] ?? '').trim() === '') return;
    rows.push({ row: i + 2, cells: Object.fromEntries(header.map((h, k) => [h, (r[k] ?? '').trim()])) });
  });
  return rows;
}

function integerField(file: string, row: number, name: string, value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) fail(file, row, `${name} must be a non-negative integer, found "${value ?? ''}"`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) fail(file, row, `${name} is too large`);
  return n;
}

function commonFields(file: string, row: number, cells: Record<string, string>) {
  const employees = integerField(file, row, 'employees', cells['employees']);
  const page = integerField(file, row, 'page', cells['page']);
  if (page < 1) fail(file, row, 'page must be a positive integer');
  const sourceUrl = cells['source_url'] ?? '';
  const tableId = cells['table_id'] ?? '';
  if (sourceUrl === '') fail(file, row, 'source_url is empty');
  if (tableId === '') fail(file, row, 'table_id is empty');
  return { employees, page, sourceUrl, tableId };
}

/** Parses the 41-row district table: no missing, duplicate or unknown District_Code; ascending code order. */
export function parseCensusEmployees(text: string, file: string = CENSUS_EMPLOYEES_TABLE): CensusEmployeeRow[] {
  const known = new Set(DISTRICTS.map((d) => d.code));
  const seen = new Set<string>();
  const out: CensusEmployeeRow[] = [];
  for (const { row, cells } of readRows(text, file, CENSUS_EMPLOYEE_COLUMNS)) {
    const districtCode = cells['district_code'] ?? '';
    if (!known.has(districtCode)) fail(file, row, `unknown district_code "${districtCode}"`);
    if (seen.has(districtCode)) fail(file, row, `duplicate district_code ${districtCode}`);
    seen.add(districtCode);
    const previous = out[out.length - 1];
    if (previous !== undefined && previous.districtCode >= districtCode) fail(file, row, 'rows must be in ascending district_code order');
    out.push({ row, districtCode, ...commonFields(file, row, cells) });
  }
  const missing = DISTRICTS.filter((d) => !seen.has(d.code)).map((d) => d.code);
  if (missing.length > 0) {
    throw new DataError('missing district_code', file, [`table: ${file}`, `missing: ${missing.join(', ')}`]);
  }
  return out;
}

/** Parses the 2-row totals table (`Taipei`, `New Taipei`). */
export function parseCensusTotals(text: string, file: string = CENSUS_TOTALS_TABLE): CensusTotalRow[] {
  const out: CensusTotalRow[] = [];
  for (const { row, cells } of readRows(text, file, CENSUS_TOTAL_COLUMNS)) {
    const city = cells['city'];
    if (city !== 'Taipei' && city !== 'New Taipei') fail(file, row, `unknown city "${city ?? ''}"`);
    if (out.some((o) => o.city === city)) fail(file, row, `duplicate city ${city}`);
    out.push({ row, city, ...commonFields(file, row, cells) });
  }
  for (const city of ['Taipei', 'New Taipei'] as const) {
    if (!out.some((o) => o.city === city)) throw new DataError('missing city', file, [`table: ${file}`, `missing: ${city}`]);
  }
  return out;
}

/**
 * Checks that the 12 Taipei and the 29 New Taipei district values sum to the printed totals. A mismatch
 * throws `DataError` naming the city, the sum, the printed total and the difference (sum - printed).
 */
export function checkCensusTotals(employees: readonly CensusEmployeeRow[], totals: readonly CensusTotalRow[]): void {
  const cityOf = new Map(DISTRICTS.map((d) => [d.code, d.city]));
  for (const total of totals) {
    const sum = employees.reduce((acc, e) => (cityOf.get(e.districtCode) === total.city ? acc + e.employees : acc), 0);
    if (sum !== total.employees) {
      const difference = sum - total.employees;
      throw new DataError('census total mismatch', `${total.city}: sum ${sum}, printed total ${total.employees}, difference ${difference}`, [
        `city: ${total.city}`,
        `sum of district rows: ${sum}`,
        `printed total: ${total.employees}`,
        `difference: ${difference}`,
      ]);
    }
  }
}

/** Reads the two committed tables and runs the check. Reads no raw file and no PDF. */
export function censusCheckStep(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'census-check',
    run(_ctx: BuildContext, _state: BuildState) {
      const employees = parseCensusEmployees(readCommitted(CENSUS_EMPLOYEES_TABLE));
      const totals = parseCensusTotals(readCommitted(CENSUS_TOTALS_TABLE));
      checkCensusTotals(employees, totals);
    },
  };
}
