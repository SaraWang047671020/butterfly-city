/**
 * Parsers for the MOI household-registration village tables (pure: text in, typed rows out).
 *
 * Population (people_total per village):  ODRP005 (CSV, 2015-2017), ODRP014 (JSON per county, last
 *                                          month of each quarter, 2018-03..2025-12)
 * Migration  (in/out totals per village):  ODRP002 (CSV, 2015-12..2017-12), ODRP011 (JSON per county,
 *                                          2018-01..2025-12; CSV for 2024-08)
 * ODRP010 and ODRP060 are NOT population tables: they hold births, deaths and marriages only (no
 * `people_total`), so `parsePopulation*` fails on them with a ParseError. Population from 2018 is ODRP014.
 *
 * Layouts handled (the column is found by name, never by position):
 *   - English snake_case headers (ODRP005, ODRP002 CSV and ris.gov.tw JSON): `statistic_yyymm`, `site_id`
 *     (county + district, e.g. 新北市板橋區), `village`, optional `district_code` (11 digits: 8-digit
 *     district code + 3-digit village), `people_total`, `in_total_m`, `in_total_f`, `out_total_m`, `out_total_f`.
 *   - Chinese headers (data.gov.tw CSV fallbacks): `統計年月`, `區域別`, `村里名稱`, `區域別代碼`,
 *     `遷入人數_合計_男/女`, `遷出人數_合計_男/女`.
 *
 * District mapping: when the file has a code column, the first 8 digits of the village code are the district
 * code; otherwise the `site_id` / 區域別 name is matched with `districtByZh` after 台 → 臺 normalization.
 *
 * Scope rules:
 *   - Rows outside Taipei and New Taipei are skipped (national files carry all 22 counties).
 *   - A row inside the two cities that matches no district throws `DataError` (rule `unmatched-district`)
 *     naming the file, row and value, so the build stops (Requirement 5.5). Unmatched rows are never returned.
 *   - A missing required column throws `ParseError` (file, row 1, expected names, found names).
 *   - A count that is not a non-negative integer throws `ParseError` naming the row.
 *
 * Row numbers are 1-based: CSV row 1 is the header and data starts at row 2; for JSON, record n is row n.
 */
import { parseCsv } from '../../lib/csv.ts';
import { DISTRICTS, districtByZh } from '../../lib/districts.ts';
import { DataError, ParseError } from '../errors.ts';

export interface PopulationVillageRow {
  /** ROC year-month as written in the file, e.g. "10412". */
  readonly month: string;
  readonly districtCode: string;
  readonly village: string;
  readonly peopleTotal: number;
}

export interface MigrationVillageRow {
  readonly month: string;
  readonly districtCode: string;
  readonly village: string;
  readonly inMale: number;
  readonly inFemale: number;
  readonly outMale: number;
  readonly outFemale: number;
}

type Cell = string | undefined;
/** One record with all of its fields addressable by header name. */
type Record_ = Readonly<Record<string, Cell>>;

interface Field {
  /** Accepted header names, first is the canonical one. */
  readonly names: readonly string[];
  readonly required: boolean;
}

const MONTH: Field = { names: ['statistic_yyymm', '統計年月'], required: true };
const SITE: Field = { names: ['site_id', '區域別'], required: true };
const VILLAGE: Field = { names: ['village', '村里名稱'], required: true };
const CODE: Field = { names: ['district_code', '區域別代碼'], required: false };

const POPULATION_FIELDS = { month: MONTH, site: SITE, village: VILLAGE, code: CODE, peopleTotal: { names: ['people_total'], required: true } } as const;
const MIGRATION_FIELDS = {
  month: MONTH,
  site: SITE,
  village: VILLAGE,
  code: CODE,
  inMale: { names: ['in_total_m', '遷入人數_合計_男'], required: true },
  inFemale: { names: ['in_total_f', '遷入人數_合計_女'], required: true },
  outMale: { names: ['out_total_m', '遷出人數_合計_男'], required: true },
  outFemale: { names: ['out_total_f', '遷出人數_合計_女'], required: true },
} as const;

type FieldSet = Readonly<Record<string, Field>>;

/** The ris.gov.tw JSON files carry a byte-order mark inside the first key ("\ufeffstatistic_yyymm"); drop it. */
function stripBom(name: string): string {
  return name.replaceAll('\uFEFF', '');
}

const byCode = new Map(DISTRICTS.map((d) => [d.code, d]));

/** 台 and 臺 are interchangeable in source files; the district table uses 臺. */
export function normalizeTai(name: string): string {
  return name.trim().replaceAll('台', '臺');
}

function expectedNames(fields: FieldSet): string[] {
  return Object.values(fields)
    .filter((f) => f.required)
    .map((f) => f.names.join(' | '));
}

/** Returns, for every field, the header name present in `found` (undefined if absent). Throws if a required one is missing. */
function resolveColumns(fields: FieldSet, found: readonly string[], file: string): Record<string, string | undefined> {
  const present = new Set(found);
  const out: Record<string, string | undefined> = {};
  for (const [key, field] of Object.entries(fields)) {
    out[key] = field.names.find((n) => present.has(n));
    if (field.required && out[key] === undefined) {
      throw new ParseError(file, 1, expectedNames(fields), found, `missing required column ${field.names.join(' | ')}`);
    }
  }
  return out;
}

function parseCount(value: Cell, column: string, file: string, row: number): number {
  const v = (value ?? '').trim();
  if (!/^\d+$/.test(v)) {
    throw new ParseError(file, row, [`${column}: non-negative integer`], [`${column}: ${JSON.stringify(value ?? null)}`], `${column} is not a non-negative integer`);
  }
  return Number(v);
}

/**
 * Maps one record to a district code, or undefined when the row is outside the two cities.
 * Throws DataError for a row inside them that matches no district.
 */
function districtOf(code: Cell, site: string, file: string, row: number): string | undefined {
  const c = (code ?? '').trim();
  const name = normalizeTai(site);
  if (c !== '') {
    if (!c.startsWith('63') && !c.startsWith('65')) return undefined;
    const d = byCode.get(c.slice(0, 8));
    if (d) return d.code;
    throw new DataError('unmatched-district', `${file} row ${row}`, [`value: ${c} (${site})`]);
  }
  if (!name.startsWith('臺北市') && !name.startsWith('新北市')) return undefined;
  const d = districtByZh(name);
  if (d) return d.code;
  throw new DataError('unmatched-district', `${file} row ${row}`, [`value: ${site}`]);
}

interface Table {
  readonly header: readonly string[];
  /** Records with their 1-based row numbers. */
  readonly records: readonly { readonly row: number; readonly cells: Record_ }[];
}

function csvTable(text: string): Table {
  const [header, ...rest] = parseCsv(text);
  const names = (header ?? []).map((h) => stripBom(h).trim());
  const records = rest
    .map((cells, i) => ({ row: i + 2, cells }))
    .filter((r) => r.cells.length > 1 || (r.cells.length === 1 && r.cells[0] !== ''))
    .map((r) => ({ row: r.row, cells: Object.fromEntries(names.map((n, i) => [n, r.cells[i]])) as Record_ }));
  return { header: names, records };
}

function jsonTable(text: string, file: string): Table {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ParseError(file, 1, ['a JSON array of records'], ['text that is not valid JSON'], 'invalid JSON');
  }
  if (!Array.isArray(data) || data.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
    throw new ParseError(file, 1, ['a JSON array of records'], [Array.isArray(data) ? 'array with non-object items' : typeof data], 'unexpected JSON shape');
  }
  const records = (data as Record<string, unknown>[]).map((r, i) => ({
    row: i + 1,
    cells: Object.fromEntries(Object.entries(r).map(([k, v]) => [stripBom(k), v === null || v === undefined ? undefined : String(v)])) as Record_,
  }));
  // Empty array: no header to check. The caller decides whether an empty month is an error (Requirement 5.6).
  return { header: records[0] ? Object.keys(records[0].cells) : [], records };
}

function readRows<T>(
  table: Table,
  fields: FieldSet,
  file: string,
  build: (cols: Record<string, string | undefined>, cells: Record_, row: number, district: string, month: string, village: string) => T,
): T[] {
  if (table.records.length === 0 && table.header.length === 0) return [];
  const cols = resolveColumns(fields, table.header, file);
  const out: T[] = [];
  for (const { row, cells } of table.records) {
    // JSON records can differ from each other, and CSV rows can be short: every record must carry every required column.
    for (const [key, field] of Object.entries(fields)) {
      if (field.required && cells[cols[key]!] === undefined) {
        throw new ParseError(file, row, expectedNames(fields), table.header, `row has no value for ${field.names.join(' | ')}`);
      }
    }
    const district = districtOf(cols['code'] ? cells[cols['code']] : undefined, cells[cols['site']!] ?? '', file, row);
    if (district === undefined) continue;
    const month = (cells[cols['month']!] ?? '').trim();
    if (!/^\d{5}$/.test(month)) {
      throw new ParseError(file, row, ['statistic_yyymm: 5 digits'], [`statistic_yyymm: ${JSON.stringify(month)}`], 'month is not a 5-digit ROC year-month');
    }
    out.push(build(cols, cells, row, district, month, (cells[cols['village']!] ?? '').trim()));
  }
  return out;
}

function populationRows(table: Table, file: string): PopulationVillageRow[] {
  return readRows(table, POPULATION_FIELDS, file, (cols, cells, row, districtCode, month, village) => ({
    month,
    districtCode,
    village,
    peopleTotal: parseCount(cells[cols['peopleTotal']!], 'people_total', file, row),
  }));
}

function migrationRows(table: Table, file: string): MigrationVillageRow[] {
  return readRows(table, MIGRATION_FIELDS, file, (cols, cells, row, districtCode, month, village) => {
    const n = (key: string) => parseCount(cells[cols[key]!], MIGRATION_FIELDS[key as keyof typeof MIGRATION_FIELDS].names[0]!, file, row);
    return { month, districtCode, village, inMale: n('inMale'), inFemale: n('inFemale'), outMale: n('outMale'), outFemale: n('outFemale') };
  });
}

/** Village population rows of the two cities from a CSV file (ODRP005 layout). */
export function parsePopulationCsv(text: string, file: string): PopulationVillageRow[] {
  return populationRows(csvTable(text), file);
}

/** Village population rows of the two cities from a ris.gov.tw JSON file. */
export function parsePopulationJson(text: string, file: string): PopulationVillageRow[] {
  return populationRows(jsonTable(text, file), file);
}

/** Village migration rows of the two cities from a CSV file (ODRP002, or the Chinese-header ODRP011 CSV). */
export function parseMigrationCsv(text: string, file: string): MigrationVillageRow[] {
  return migrationRows(csvTable(text), file);
}

/** Village migration rows of the two cities from a ris.gov.tw ODRP011 JSON file. */
export function parseMigrationJson(text: string, file: string): MigrationVillageRow[] {
  return migrationRows(jsonTable(text, file), file);
}
