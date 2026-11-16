/**
 * Typed loaders for the three committed policy tables in `data/config/` (pure: text in, rows out).
 *
 *   holding-tax-rates.csv      city,effective_date,lowest_rate,highest_rate,legal_text,article_or_version,source,url
 *   commuter-pass-products.csv city,product,start_date,price_twd,source,url
 *   sublease-phases.csv        city,channel,phase,start_date,total_units,as_of,source,url
 *
 * A missing column throws `ParseError` (file, row 1, expected, found). Every row is then checked (Requirement 12.15):
 * valid ISO date; a date later than the previous row of the same key (holding tax: city; commuter pass: city;
 * sublease: city and channel, with the phase number rising too); a positive rate or price; a non-empty source;
 * lowest rate not above highest rate. A failed check throws `DataError` naming the table path, the row number
 * (the CSV line, header = 1) and the reason.
 */
import { parseCsv } from '../../lib/csv.ts';
import { DataError, ParseError } from '../errors.ts';

export type HoldingTaxCity = 'Taipei' | 'New Taipei' | 'statutory';
export type TableCity = 'Taipei' | 'New Taipei';

export interface HoldingTaxRateRow {
  readonly row: number;
  readonly city: HoldingTaxCity;
  /** ISO date `YYYY-MM-DD`. */
  readonly effectiveDate: string;
  readonly lowestRate: number;
  readonly highestRate: number;
  readonly legalText: string;
  readonly articleOrVersion: string;
  readonly source: string;
  readonly url: string;
}

export interface CommuterPassProductRow {
  readonly row: number;
  readonly city: TableCity;
  readonly product: string;
  /** ISO start date of the product; named `effectiveDate` so `lookupEffective` applies. */
  readonly effectiveDate: string;
  readonly priceTwd: number;
  readonly source: string;
  readonly url: string;
}

export type SubleaseChannel = 'city' | 'central';

export interface SubleasePhaseRow {
  readonly row: number;
  readonly city: TableCity;
  readonly channel: SubleaseChannel;
  readonly phase: number;
  readonly startDate: string;
  readonly totalUnits: number;
  readonly asOf: string;
  readonly source: string;
  readonly url: string;
}

function fail(file: string, row: number, reason: string): never {
  throw new DataError(`row check failed (${reason})`, `${file} row ${row}`, [`table: ${file}`, `row: ${row}`, `reason: ${reason}`]);
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

interface Table {
  readonly rows: { readonly row: number; readonly cells: Record<string, string> }[];
}

function readTable(text: string, file: string, columns: readonly string[]): Table {
  const [rawHeader, ...rest] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const missing = columns.find((c) => !header.includes(c));
  if (missing !== undefined) {
    throw new ParseError(file, 1, columns, header, `missing required column ${missing}`);
  }
  const rows: Table['rows'][number][] = [];
  rest.forEach((r, i) => {
    if (r.length === 1 && (r[0] ?? '').trim() === '') return; // blank line
    const cells = Object.fromEntries(header.map((h, k) => [h, (r[k] ?? '').trim()]));
    rows.push({ row: i + 2, cells });
  });
  return { rows };
}

function isoDate(cells: Record<string, string>, col: string, file: string, row: number): string {
  const v = cells[col] ?? '';
  if (!isIsoDate(v)) fail(file, row, `${col} ${JSON.stringify(v)} is not a valid ISO date (YYYY-MM-DD)`);
  return v;
}

function positive(cells: Record<string, string>, col: string, file: string, row: number): number {
  const v = cells[col] ?? '';
  const n = /^\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) fail(file, row, `${col} ${JSON.stringify(v)} is not a positive number`);
  return n;
}

function source(cells: Record<string, string>, file: string, row: number): string {
  const v = cells['source'] ?? '';
  if (v === '') fail(file, row, 'source is empty');
  return v;
}

/** Fails when `date` is not later than the previous date stored for `key`; records `date` otherwise. */
function ordered(last: Map<string, string>, key: string, date: string, file: string, row: number): void {
  const prev = last.get(key);
  if (prev !== undefined && date <= prev) {
    fail(file, row, `date ${date} is not later than the previous row of ${key} (${prev})`);
  }
  last.set(key, date);
}

export function parseHoldingTaxRates(text: string, file: string): HoldingTaxRateRow[] {
  const t = readTable(text, file, ['city', 'effective_date', 'lowest_rate', 'highest_rate', 'legal_text', 'article_or_version', 'source']);
  const last = new Map<string, string>();
  return t.rows.map(({ row, cells }) => {
    const city = cells['city'] as string;
    if (city !== 'Taipei' && city !== 'New Taipei' && city !== 'statutory') {
      fail(file, row, `city ${JSON.stringify(city)} is not Taipei, New Taipei or statutory`);
    }
    const effectiveDate = isoDate(cells, 'effective_date', file, row);
    ordered(last, city, effectiveDate, file, row);
    const lowestRate = positive(cells, 'lowest_rate', file, row);
    const highestRate = positive(cells, 'highest_rate', file, row);
    if (lowestRate > highestRate) fail(file, row, `lowest_rate ${lowestRate} is above highest_rate ${highestRate}`);
    return {
      row,
      city: city as HoldingTaxCity,
      effectiveDate,
      lowestRate,
      highestRate,
      legalText: cells['legal_text'] as string,
      articleOrVersion: cells['article_or_version'] as string,
      source: source(cells, file, row),
      url: cells['url'] ?? '',
    };
  });
}

export function parseCommuterPassProducts(text: string, file: string): CommuterPassProductRow[] {
  const t = readTable(text, file, ['city', 'product', 'start_date', 'price_twd', 'source']);
  const last = new Map<string, string>();
  return t.rows.map(({ row, cells }) => {
    const city = cells['city'] as string;
    if (city !== 'Taipei' && city !== 'New Taipei') fail(file, row, `city ${JSON.stringify(city)} is not Taipei or New Taipei`);
    const effectiveDate = isoDate(cells, 'start_date', file, row);
    ordered(last, city, effectiveDate, file, row);
    return {
      row,
      city: city as TableCity,
      product: cells['product'] as string,
      effectiveDate,
      priceTwd: positive(cells, 'price_twd', file, row),
      source: source(cells, file, row),
      url: cells['url'] ?? '',
    };
  });
}

export function parseSubleasePhases(text: string, file: string): SubleasePhaseRow[] {
  const t = readTable(text, file, ['city', 'channel', 'phase', 'start_date', 'total_units', 'as_of', 'source']);
  const last = new Map<string, string>();
  const lastPhase = new Map<string, number>();
  return t.rows.map(({ row, cells }) => {
    const city = cells['city'] as string;
    if (city !== 'Taipei' && city !== 'New Taipei') fail(file, row, `city ${JSON.stringify(city)} is not Taipei or New Taipei`);
    const channel = cells['channel'] as string;
    if (channel !== 'city' && channel !== 'central') fail(file, row, `channel ${JSON.stringify(channel)} is not city or central`);
    const phaseCell = cells['phase'] as string;
    if (!/^[1-9]\d*$/.test(phaseCell)) fail(file, row, `phase ${JSON.stringify(phaseCell)} is not a positive integer`);
    const phase = Number(phaseCell);
    const startDate = isoDate(cells, 'start_date', file, row);
    const key = `${city}/${channel}`;
    ordered(last, key, startDate, file, row);
    const prevPhase = lastPhase.get(key);
    if (prevPhase !== undefined && phase <= prevPhase) {
      fail(file, row, `phase ${phase} does not follow phase ${prevPhase} of ${key}`);
    }
    lastPhase.set(key, phase);
    const unitsCell = cells['total_units'] as string;
    if (!/^\d+$/.test(unitsCell)) fail(file, row, `total_units ${JSON.stringify(unitsCell)} is not a non-negative integer`);
    const asOf = isoDate(cells, 'as_of', file, row);
    if (asOf < startDate) fail(file, row, `as_of ${asOf} is before start_date ${startDate}`);
    return {
      row,
      city: city as TableCity,
      channel: channel as SubleaseChannel,
      phase,
      startDate,
      totalUnits: Number(unitsCell),
      asOf,
      source: source(cells, file, row),
      url: cells['url'] ?? '',
    };
  });
}

/**
 * The row of `city` with the latest `effectiveDate` that is not after `date` (ISO `YYYY-MM-DD`), or undefined when
 * the city has no row in force on that date. Rows may come in any order.
 */
export function lookupEffective<T extends { readonly city: string; readonly effectiveDate: string }>(
  rows: readonly T[],
  city: string,
  date: string,
): T | undefined {
  let best: T | undefined;
  for (const r of rows) {
    if (r.city !== city || r.effectiveDate > date) continue;
    if (best === undefined || r.effectiveDate > best.effectiveDate) best = r;
  }
  return best;
}
