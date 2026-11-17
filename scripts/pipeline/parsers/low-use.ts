/**
 * Parser for the MOI low-use housing files `low-use/moi-low-use-current-{period}-{63000,65000}.csv`
 * (UTF-8 with BOM; 63000 = Taipei, 65000 = New Taipei).
 *
 * Layout: header `縣市`, `鄉鎮市區`, `{period}宅數`, `{period}比率(%)`, then one row per district plus a
 * city total row (`全區`, skipped). `{period}` is taken from the file name: an ROC year (`104`..`108`, annual
 * values) or an ROC half year (`109H1`..`114H2`). Annual year N maps to the second half of N + 1911
 * (2015H2..2019H2, Nov-Dec basis); half-yearly values are read as is (2020H1..2025H2).
 *
 * The rate column is read as a percentage when its header contains `%` (or the cell ends with `%`);
 * otherwise it is read as a fraction and multiplied by 100.
 *
 * Only `current`-method files are read. A file named `moi-low-use-original-*` is never opened.
 * An unknown layout throws `ParseError` with file, row, expected and found columns.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { districtByZh } from '../../lib/districts.ts';
import { ParseError } from '../errors.ts';
import type { RawReader } from '../raw-reader.ts';

export interface LowUseRow {
  /** `YYYYH1` or `YYYYH2`. */
  readonly period: string;
  readonly districtCode: string;
  /** Number of low-use dwellings. */
  readonly count: number;
  /** Share of dwellings, in percent. */
  readonly ratePercent: number;
}

const COUNTY_CODES = ['63000', '65000'] as const;

/** Period labels of the file names: ROC annual years 104..108, then ROC half years 109H1..114H2. */
export function lowUseFilePeriods(): string[] {
  const out: string[] = ['104', '105', '106', '107', '108'];
  for (let y = 109; y <= 114; y++) out.push(`${y}H1`, `${y}H2`);
  return out;
}

/** The 34 current-method file paths, relative to data/raw/. */
export function lowUseFiles(): string[] {
  const out: string[] = [];
  for (const p of lowUseFilePeriods()) {
    for (const c of COUNTY_CODES) out.push(`low-use/moi-low-use-current-${p}-${c}.csv`);
  }
  return out;
}

/** `104` → `2015H2`; `110H1` → `2021H1`. Undefined for any other label. */
export function lowUsePeriod(label: string): string | undefined {
  const m = /^(\d{3})(H[12])?$/.exec(label);
  if (!m) return undefined;
  return `${Number(m[1]) + 1911}${m[2] ?? 'H2'}`;
}

/** Parses one file's text. `file` is the path shown in messages; the period label comes from its name. */
export function parseLowUseText(text: string, file: string): LowUseRow[] {
  const m = /^moi-low-use-current-(\d{3}(?:H[12])?)-(63000|65000)\.csv$/.exec(file.split('/').pop() ?? '');
  const period = m === null ? undefined : lowUsePeriod(m[1] ?? '');
  if (m === null || period === undefined) {
    throw new ParseError(file, undefined, ['file name moi-low-use-current-{period}-{63000|65000}.csv'], [file], 'unknown file name');
  }
  const label = m[1] as string;
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected = ['縣市', '鄉鎮市區', `${label}宅數`, `${label}比率(%)`];
  const rateIsPercentHeader = (header[3] ?? '').includes('%');
  const rateHeaderOk = header[3] === `${label}比率(%)` || header[3] === `${label}比率`;
  if (header.length !== 4 || header[0] !== expected[0] || header[1] !== expected[1] || header[2] !== expected[2] || !rateHeaderOk) {
    throw new ParseError(file, 1, expected, header, 'unknown layout');
  }
  const out: LowUseRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 2;
    if (r.every((c) => c.trim() === '')) return;
    const found = r.map((c) => c.trim());
    if (found.length !== 4) throw new ParseError(file, row, expected, found, 'row has the wrong number of columns');
    const [city, name, countCell, rateCell] = found as [string, string, string, string];
    if (name === '全區') return;
    const d = districtByZh(city + name);
    if (d === undefined) throw new ParseError(file, row, ['district of 臺北市 or 新北市'], found, `unknown district ${JSON.stringify(city + name)}`);
    if (seen.has(d.code)) throw new ParseError(file, row, ['each district once'], found, `district ${d.code} appears twice`);
    seen.add(d.code);
    const count = parseNumber(countCell);
    const pct = rateCell.endsWith('%');
    const rate = parseNumber(pct ? rateCell.slice(0, -1) : rateCell);
    if (!Number.isFinite(count) || !Number.isFinite(rate)) {
      throw new ParseError(file, row, [`${expected[2]}: number`, `${expected[3]}: number`], found, 'count or rate is not a number');
    }
    out.push({
      period,
      districtCode: d.code,
      count,
      ratePercent: pct || rateIsPercentHeader ? rate : Math.round(rate * 100 * 1e6) / 1e6,
    });
  });
  return out;
}

/** Reads the 34 current-method files (never an `original` file). Rows are in file-list order. */
export function parseLowUse(reader: RawReader): LowUseRow[] {
  const out: LowUseRow[] = [];
  for (const rel of lowUseFiles()) out.push(...parseLowUseText(reader.readText(rel), reader.display(rel)));
  return out;
}

/** Sorted periods that have at least one district value. */
export function periodsPresent(rows: readonly LowUseRow[]): string[] {
  return [...new Set(rows.map((r) => r.period))].sort();
}
