/**
 * Parsers for the rent-subsidy raw files (pure: text in, rows out).
 *
 * MOI E3010 JSON tables 6_1_3 and 6_3_1: `resultTable` is an array of rows. The first row is the header
 * (`縣市`, then ROC quarters such as `104Q1`; add 1911 to the ROC year). Each later row is one city
 * (`台北市` or `新北市`; `臺北市` is accepted too) followed by one cell per quarter, with thousands separators and
 * decimals (`"4,213.00"`). A cell with no figure (empty, `-`, `－`, `…`) is omitted from the output.
 *
 * MOI dataset 169800 (CSV): one row per ROC year and region. Columns used: `年`, `地區`,
 * `租金補貼戶數計` (household-months in the year) and `租金補貼金額計` (subsidy amount, NT$ thousand).
 * Only the rows of the two cities are returned.
 *
 * A missing header or column, an unknown city label or a non-numeric cell throws `ParseError`.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { ROC_OFFSET, type Quarter } from '../../lib/time.ts';
import { ParseError } from '../errors.ts';

export type PolicyCity = 'Taipei' | 'New Taipei';

export interface E3010Row {
  readonly city: PolicyCity;
  readonly quarter: Quarter;
  readonly value: number;
}

export interface RentAmountRow {
  readonly city: PolicyCity;
  /** Gregorian year (ROC year + 1911). */
  readonly year: number;
  /** Household-months of rent subsidy in the year. */
  readonly householdMonths: number;
  /** Subsidy amount in NT$ thousand. */
  readonly amountThousand: number;
}

/** City label of the MOI files to the city name, or undefined for any other label. */
export function normalizeCityLabel(label: string): PolicyCity | undefined {
  const s = label.trim();
  if (s === '台北市' || s === '臺北市') return 'Taipei';
  if (s === '新北市') return 'New Taipei';
  return undefined;
}

const NO_FIGURE = new Set(['', '-', '－', '—', '…', '...']);

/** `104Q1` → `2015Q1`, or undefined when the cell is not an ROC quarter. */
export function rocQuarterToQuarter(cell: string): Quarter | undefined {
  const m = /^(\d{2,3})Q([1-4])$/.exec(cell.trim());
  if (!m) return undefined;
  return `${Number(m[1]) + ROC_OFFSET}Q${m[2] as '1' | '2' | '3' | '4'}`;
}

export function parseE3010(text: string, file: string): E3010Row[] {
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ParseError(file, undefined, ['JSON object with resultTable'], ['not valid JSON'], 'not valid JSON');
  }
  const table = (json as { resultTable?: unknown } | null)?.resultTable;
  if (!Array.isArray(table) || table.length === 0 || !table.every((r) => Array.isArray(r))) {
    throw new ParseError(file, undefined, ['resultTable: array of rows'], [JSON.stringify(Object.keys((json as object | null) ?? {}))], 'resultTable is missing or not an array of rows');
  }
  const rows = table as unknown[][];
  const header = (rows[0] ?? []).map((c) => String(c ?? '').trim());
  const quarters: (Quarter | undefined)[] = header.slice(1).map(rocQuarterToQuarter);
  if (quarters.length === 0 || quarters.some((q) => q === undefined)) {
    const bad = header.slice(1).find((h) => rocQuarterToQuarter(h) === undefined);
    throw new ParseError(file, 1, ['縣市', 'ROC quarter headers such as 104Q1'], header, bad === undefined ? 'no quarter headers' : `header ${JSON.stringify(bad)} is not an ROC quarter`);
  }
  const out: E3010Row[] = [];
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const label = String(r[0] ?? '').trim();
    const city = normalizeCityLabel(label);
    if (city === undefined) {
      throw new ParseError(file, row, ['city label 台北市 or 新北市'], [label], `unknown city label ${JSON.stringify(label)}`);
    }
    quarters.forEach((quarter, k) => {
      const cell = String(r[k + 1] ?? '').trim();
      if (NO_FIGURE.has(cell)) return;
      const value = parseNumber(cell);
      if (!Number.isFinite(value)) {
        throw new ParseError(file, row, [`${header[k + 1]}: number`], [`${header[k + 1]}: ${JSON.stringify(cell)}`], `${header[k + 1]} is not a number`);
      }
      out.push({ city, quarter: quarter as Quarter, value });
    });
  });
  return out;
}

function cell(r: readonly string[], col: number, name: string, file: string, row: number): number {
  const raw = (r[col] ?? '').trim();
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) {
    throw new ParseError(file, row, [`${name}: number`], [`${name}: ${JSON.stringify(raw)}`], `${name} is not a number`);
  }
  return n;
}

export function parseRentAmount169800(text: string, file: string): RentAmountRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected = ['年', '地區', '租金補貼戶數計', '租金補貼金額計'];
  const idx = expected.map((n) => header.indexOf(n));
  const missing = idx.findIndex((i) => i < 0);
  if (missing >= 0) {
    throw new ParseError(file, 1, expected, header, `missing required column ${expected[missing]}`);
  }
  const [yearCol, regionCol, monthsCol, amountCol] = idx as [number, number, number, number];
  const out: RentAmountRow[] = [];
  rows.forEach((r, i) => {
    const city = normalizeCityLabel(r[regionCol] ?? '');
    if (city === undefined) return;
    const row = i + 2;
    const yearCell = (r[yearCol] ?? '').trim();
    if (!/^\d{2,3}$/.test(yearCell)) {
      throw new ParseError(file, row, ['年: ROC year'], [`年: ${JSON.stringify(yearCell)}`], '年 is not an ROC year');
    }
    out.push({
      city,
      year: Number(yearCell) + ROC_OFFSET,
      householdMonths: cell(r, monthsCol, '租金補貼戶數計', file, row),
      amountThousand: cell(r, amountCol, '租金補貼金額計', file, row),
    });
  });
  return out;
}
