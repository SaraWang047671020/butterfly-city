/**
 * Parser for the real-price registration season files (MOI 實價登錄, data.gov.tw 25119 sales and 25118 rentals).
 *
 * File name `{season}_{a|f}_lvr_land_{a|c}.csv`: `a` = Taipei City and `f` = New Taipei City (same convention as
 * `scripts/sources/lvr.ts`, which cannot be imported here because it imports the HTTP helpers); the last letter
 * is the kind, `a` = sales and `c` = rentals. Row 1 holds the Chinese header, row 2 the English header, data
 * starts on row 3.
 *
 * `parseLvrCsv` returns every data row as a typed record, with `districtCode` and `quarter` undefined when they
 * cannot be resolved. `dedupeById` removes repeated `編號` values (first occurrence in sorted file order wins).
 * `classifyLvr` gives the exclusion reason of one record, or undefined when the record qualifies. Reasons are
 * checked in the order of `EXCLUSION_REASONS` without `duplicate`, which `dedupeById` counts.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { districtByZh } from '../../lib/districts.ts';
import { FIRST_YEAR, LAST_YEAR, rocToAd, type Quarter } from '../../lib/time.ts';
import { ParseError } from '../errors.ts';
import { codePointCompare } from '../numeric.ts';

export type LvrKind = 'sale' | 'rental';

export type ExclusionReason =
  | 'invalid-date'
  | 'out-of-range'
  | 'unknown-district'
  | 'non-residential'
  | 'non-building'
  | 'zero-value'
  | 'duplicate';

export const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  'invalid-date',
  'out-of-range',
  'unknown-district',
  'non-residential',
  'non-building',
  'zero-value',
  'duplicate',
];

export type ExclusionCounts = Record<ExclusionReason, number>;

export interface LvrRecord {
  /** `編號`, the record id used for de-duplication. Empty when the cell is empty. */
  readonly id: string;
  readonly kind: LvrKind;
  /** Official district code, or undefined when `鄉鎮市區` is not one of the 41 districts of the file's city. */
  readonly districtCode: string | undefined;
  /** Quarter of the transaction or lease date, or undefined when the date is not a valid 7-digit ROC date. May lie outside 2015Q1..2025Q4. */
  readonly quarter: Quarter | undefined;
  /** `交易標的` (empty for none). */
  readonly target: string;
  /** `主要用途`. */
  readonly use: string;
  /** `單價元平方公尺`, NT$ per m²; 0 when empty or not a number. */
  readonly unitPrice: number;
  /** Sales: `總價元`, NT$; 0 when empty or not a number. Rentals: 0. */
  readonly totalPrice: number;
  /** Rentals: `總額元`, NT$ per month; 0 when empty or not a number. Sales: 0. */
  readonly rent: number;
  /** Rentals: `建物總面積平方公尺`; sales: `建物移轉總面積平方公尺`; m², 0 when empty or not a number. */
  readonly area: number;
}

export function emptyExclusions(): ExclusionCounts {
  return {
    'invalid-date': 0,
    'out-of-range': 0,
    'unknown-district': 0,
    'non-residential': 0,
    'non-building': 0,
    'zero-value': 0,
    duplicate: 0,
  };
}

/** One line per reason in fixed order, e.g. `invalid-date: 3`, for the build output. */
export function formatExclusions(counts: Readonly<ExclusionCounts>): string[] {
  return EXCLUSION_REASONS.map((r) => `${r}: ${counts[r]}`);
}

const SALE_TARGETS: ReadonlySet<string> = new Set(['房地(土地+建物)', '房地(土地+建物)+車位', '建物']);

const COLUMNS: Record<LvrKind, { date: string; value: readonly string[]; area: string }> = {
  sale: { date: '交易年月日', value: ['總價元', '單價元平方公尺'], area: '建物移轉總面積平方公尺' },
  rental: { date: '租賃年月日', value: ['總額元', '單價元平方公尺'], area: '建物總面積平方公尺' },
};

/** Columns every file of the kind must have. */
export function requiredLvrColumns(kind: LvrKind): string[] {
  const c = COLUMNS[kind];
  return ['鄉鎮市區', '交易標的', c.date, '主要用途', ...c.value, c.area, '編號'];
}

/**
 * Converts a strict 7-digit ROC date `yyymmdd` (e.g. `1031009` = 2014-10-09) to a quarter. Returns undefined
 * unless the value is exactly seven digits and has a month 01–12 and a day that exists in that month.
 * The result may lie outside 2015Q1..2025Q4.
 */
export function rocDate7ToQuarter(value: string): Quarter | undefined {
  const s = value.trim();
  if (!/^\d{7}$/.test(s)) return undefined;
  const year = rocToAd(Number(s.slice(0, 3)));
  const month = Number(s.slice(3, 5));
  const day = Number(s.slice(5, 7));
  if (month < 1 || month > 12 || day < 1) return undefined;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  if (day > days) return undefined;
  return `${year}Q${Math.ceil(month / 3) as 1 | 2 | 3 | 4}`;
}

function cityAndKind(file: string): { cityZh: string; kind: LvrKind } | undefined {
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const m = /^\d+S\d_([af])_lvr_land_([ac])\.csv$/.exec(base);
  if (!m) return undefined;
  return { cityZh: m[1] === 'a' ? '臺北市' : '新北市', kind: m[2] === 'a' ? 'sale' : 'rental' };
}

function numberOrZero(cell: string | undefined): number {
  const n = parseNumber((cell ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parses one season file. `file` is the file name or a path ending in it; it decides the city and must agree
 * with `kind`. A missing required column throws `ParseError` with row 1, the expected and the found names.
 */
export function parseLvrCsv(text: string, file: string, kind: LvrKind): LvrRecord[] {
  const [rawHeader, , ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected = requiredLvrColumns(kind);

  const info = cityAndKind(file);
  if (info === undefined || info.kind !== kind) {
    throw new ParseError(file, undefined, expected, header, `file name is not {season}_{a|f}_lvr_land_${kind === 'sale' ? 'a' : 'c'}.csv`);
  }
  const col = new Map<string, number>();
  for (const name of expected) {
    const i = header.indexOf(name);
    if (i < 0) throw new ParseError(file, 1, expected, header, `missing required column ${name}`);
    col.set(name, i);
  }
  const cell = (r: readonly string[], name: string): string => (r[col.get(name) as number] ?? '').trim();
  const c = COLUMNS[kind];

  const out: LvrRecord[] = [];
  for (const r of rows) {
    if (r.length === 1 && (r[0] ?? '').trim() === '') continue; // blank line
    const value = (name: string) => numberOrZero(cell(r, name));
    out.push({
      id: cell(r, '編號'),
      kind,
      districtCode: districtByZh(info.cityZh + cell(r, '鄉鎮市區'))?.code,
      quarter: rocDate7ToQuarter(cell(r, c.date)),
      target: cell(r, '交易標的'),
      use: cell(r, '主要用途'),
      unitPrice: value('單價元平方公尺'),
      totalPrice: kind === 'sale' ? value('總價元') : 0,
      rent: kind === 'rental' ? value('總額元') : 0,
      area: value(c.area),
    });
  }
  return out;
}

export interface LvrFile {
  readonly file: string;
  readonly records: readonly LvrRecord[];
}

/**
 * Keeps the first record of each non-empty `編號` over all files, visiting files in code point order of their
 * names and records in row order. Records with an empty id are always kept. Inputs are not modified.
 */
export function dedupeById(files: readonly LvrFile[]): { records: LvrRecord[]; duplicates: number } {
  const sorted = [...files].sort((a, b) => codePointCompare(a.file, b.file));
  const seen = new Set<string>();
  const records: LvrRecord[] = [];
  let duplicates = 0;
  for (const f of sorted) {
    for (const r of f.records) {
      if (r.id !== '') {
        if (seen.has(r.id)) {
          duplicates++;
          continue;
        }
        seen.add(r.id);
      }
      records.push(r);
    }
  }
  return { records, duplicates };
}

/**
 * Exclusion reason of one record, or undefined when it qualifies. First matching reason wins, in this order:
 * invalid-date, out-of-range, unknown-district, non-residential, non-building (sales only), zero-value.
 * Sales need `unitPrice` > 0; rentals need `rent` > 0 and `area` > 0. Never returns `duplicate`.
 */
export function classifyLvr(record: LvrRecord): Exclude<ExclusionReason, 'duplicate'> | undefined {
  if (record.quarter === undefined) return 'invalid-date';
  const year = Number(record.quarter.slice(0, 4));
  if (year < FIRST_YEAR || year > LAST_YEAR) return 'out-of-range';
  if (record.districtCode === undefined) return 'unknown-district';
  if (!record.use.includes('住家用') && !record.use.includes('住宅')) return 'non-residential';
  if (record.kind === 'sale') {
    if (!SALE_TARGETS.has(record.target)) return 'non-building';
    if (!(record.unitPrice > 0)) return 'zero-value';
  } else if (!(record.rent > 0) || !(record.area > 0)) {
    return 'zero-value';
  }
  return undefined;
}

export const qualifySale = (record: LvrRecord): boolean => record.kind === 'sale' && classifyLvr(record) === undefined;
export const qualifyRental = (record: LvrRecord): boolean => record.kind === 'rental' && classifyLvr(record) === undefined;

/**
 * Splits records (already de-duplicated) into qualifying ones and exclusion counts. `duplicates` from
 * `dedupeById` is added to the `duplicate` count.
 */
export function filterLvr(
  records: readonly LvrRecord[],
  duplicates = 0,
): { qualifying: LvrRecord[]; exclusions: ExclusionCounts } {
  const exclusions = emptyExclusions();
  exclusions.duplicate = duplicates;
  const qualifying: LvrRecord[] = [];
  for (const r of records) {
    const reason = classifyLvr(r);
    if (reason === undefined) qualifying.push(r);
    else exclusions[reason]++;
  }
  return { qualifying, exclusions };
}
