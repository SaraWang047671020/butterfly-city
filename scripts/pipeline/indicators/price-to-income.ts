/**
 * House-price-to-income ratio (Requirement 10), city level only.
 *
 *   priceToIncomeRatio(c, q) = roundTo( median{ 總價元 of qualifying sales in c, quarter q } / cityDisposableIncome(c, q), 2 )
 *
 * Qualifying sales: the sale filter plus 總價元 > 0 (this builder applies the extra condition itself).
 * The divisor is the UNROUNDED quarterly city disposable income (the value before it is rounded for
 * history.json); only the final ratio is rounded, once, to 2 decimals. Fewer than 100 qualifying sales in a
 * city-quarter, or a missing or non-positive income value, stops the build (Requirement 10.4).
 *
 * The optional hand-entered MOI table `data/config/moi-price-to-income.csv` (city,quarter,ratio,source_pdf)
 * is validated and compared in printed notes only. It never changes an output value or the exit code,
 * except that an invalid row stops the build (Requirement 10.6).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ValueRecord } from '../../../src/types/data-files.ts';
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import type { City } from '../../lib/districts.ts';
import { ROOT } from '../../lib/paths.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError, ParseError } from '../errors.ts';
import { median, roundTo } from '../numeric.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import type { Step } from '../run.ts';
import { readIncomeFiles, buildIncomeUnrounded } from './income.ts';
import { loadLvr, totalPriceSales } from './lvr-input.ts';
import type { CitySeries } from './series.ts';

export const PRICE_TO_INCOME_METHOD = 'price-to-income-computed';
/** Minimum qualifying sales per city-quarter. */
export const PTI_MIN_SALES = 100;
const CITIES: readonly City[] = ['Taipei', 'New Taipei'];
export const MOI_TABLE_REPO_PATH = 'data/config/moi-price-to-income.csv';
export const MOI_FIRST_QUARTER = '2016Q3';
export const MOI_LAST_QUARTER = '2025Q4';

export interface CityCode {
  readonly code: string;
  readonly city: City;
}

/**
 * "<city>|<quarter>" -> list of 總價元 of that city and quarter, in input order. Keeps only the sales selected
 * by `totalPriceSales` whose district belongs to a known city.
 */
export function cityTotalPrices(
  sales: readonly LvrRecord[],
  districts: readonly CityCode[],
  quarters: readonly Quarter[],
): Map<string, number[]> {
  void quarters; // accepted for symmetry with the district grouping; sales outside the quarters are never read back
  const cityOf = new Map<string, City>(districts.map((d) => [d.code, d.city]));
  const prices = new Map<string, number[]>();
  for (const r of totalPriceSales(sales)) {
    const city = cityOf.get(r.districtCode as string);
    if (city === undefined) continue;
    const key = `${city}|${r.quarter}`;
    const list = prices.get(key);
    if (list === undefined) prices.set(key, [r.totalPrice]);
    else list.push(r.totalPrice);
  }
  return prices;
}

/**
 * Builds the two city series. `sales` are sales that passed the sale filter; this function additionally keeps
 * only those selected by `totalPriceSales` (totalPrice > 0). `income` is the unrounded quarterly city
 * disposable income.
 */
export function buildPriceToIncome(
  sales: readonly LvrRecord[],
  income: ReadonlyMap<City, ReadonlyMap<Quarter, number>>,
  districts: readonly CityCode[],
  quarters: readonly Quarter[],
): CitySeries {
  const prices = cityTotalPrices(sales, districts, quarters);

  const out: CitySeries = { Taipei: [], 'New Taipei': [] };
  for (const city of CITIES) {
    for (const q of quarters) {
      const list = prices.get(`${city}|${q}`) ?? [];
      if (list.length < PTI_MIN_SALES) {
        throw new DataError('too-few-sales-for-price-to-income', `${city} ${q}`, [
          `${list.length} qualifying sales (minimum ${PTI_MIN_SALES})`,
        ]);
      }
      const denominator = income.get(city)?.get(q);
      if (denominator === undefined || !Number.isFinite(denominator) || !(denominator > 0)) {
        throw new DataError('missing-city-income', `${city} ${q}`, ['no city disposable income value for this quarter']);
      }
      const record: ValueRecord = {
        value: roundTo(median(list) / denominator, 2),
        estimated: true,
        method: PRICE_TO_INCOME_METHOD,
      };
      out[city].push(record);
    }
  }
  return out;
}

export interface MoiRatioRow {
  readonly city: City;
  readonly quarter: Quarter;
  readonly ratio: number;
  readonly sourcePdf: string;
}

const MOI_COLUMNS = ['city', 'quarter', 'ratio', 'source_pdf'] as const;

/**
 * Parses and validates the MOI table. Throws ParseError with the 1-based file row (the header is row 1) for an
 * unknown city, a quarter outside 2016Q3..2025Q4, a ratio that is not a positive number, or a repeated
 * city and quarter.
 */
export function parseMoiPriceToIncome(text: string, file: string): MoiRatioRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected: string[] = [...MOI_COLUMNS];
  const col = new Map<string, number>();
  for (const name of MOI_COLUMNS) {
    const i = header.indexOf(name);
    if (i < 0) throw new ParseError(file, 1, expected, header, `missing required column ${name}`);
    col.set(name, i);
  }
  const out: MoiRatioRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (r.length === 1 && (r[0] ?? '').trim() === '') return; // blank line
    const rowNumber = i + 2;
    const cell = (name: string): string => (r[col.get(name) as number] ?? '').trim();
    const fail = (reason: string): never => {
      throw new ParseError(file, rowNumber, expected, header, reason);
    };
    const city = cell('city');
    if (city !== 'Taipei' && city !== 'New Taipei') fail(`city must be Taipei or New Taipei, found "${city}"`);
    const quarter = cell('quarter');
    if (!/^\d{4}Q[1-4]$/.test(quarter) || quarter < MOI_FIRST_QUARTER || quarter > MOI_LAST_QUARTER) {
      fail(`quarter must be between ${MOI_FIRST_QUARTER} and ${MOI_LAST_QUARTER}, found "${quarter}"`);
    }
    const ratio = parseNumber(cell('ratio'));
    if (!Number.isFinite(ratio) || !(ratio > 0)) fail(`ratio must be a positive number, found "${cell('ratio')}"`);
    const key = `${city}|${quarter}`;
    if (seen.has(key)) fail(`duplicate row for ${city} ${quarter}`);
    seen.add(key);
    out.push({ city: city as City, quarter: quarter as Quarter, ratio, sourcePdf: cell('source_pdf') });
  });
  return out;
}

function signed(x: number): string {
  const v = roundTo(x, 2);
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/**
 * Note lines for the comparison: one per MOI row (computed, MOI, signed difference = computed - MOI), then one
 * per city that has rows with its largest absolute difference. Changes nothing else.
 */
export function comparePriceToIncome(
  computed: CitySeries,
  moiRows: readonly MoiRatioRow[],
  quarters: readonly Quarter[],
): string[] {
  const lines: string[] = [];
  const largest = new Map<City, { diff: number; quarter: Quarter }>();
  for (const row of moiRows) {
    const i = quarters.indexOf(row.quarter);
    const value = i < 0 ? undefined : computed[row.city][i]?.value;
    if (value === undefined || value === null) {
      lines.push(`price-to-income ${row.city} ${row.quarter}: no computed value to compare with MOI ratio ${row.ratio.toFixed(2)}`);
      continue;
    }
    const diff = roundTo(value - row.ratio, 2);
    lines.push(
      `price-to-income ${row.city} ${row.quarter}: computed ${value.toFixed(2)}, MOI ${row.ratio.toFixed(2)}, difference ${signed(diff)} (${row.sourcePdf})`,
    );
    const best = largest.get(row.city);
    if (best === undefined || Math.abs(diff) > Math.abs(best.diff)) largest.set(row.city, { diff, quarter: row.quarter });
  }
  for (const city of CITIES) {
    const best = largest.get(city);
    if (best !== undefined) {
      lines.push(`price-to-income ${city}: largest absolute difference ${signed(best.diff)} at ${best.quarter}`);
    }
  }
  return lines;
}

export function skippedNote(): string {
  return `price-to-income validation skipped: ${MOI_TABLE_REPO_PATH} not found`;
}

export interface PriceToIncomeStepOptions {
  /** Returns the MOI table text, or undefined when the file is absent. Default reads the committed file. */
  readonly readMoiTable?: () => string | undefined;
}

function readCommittedMoiTable(): string | undefined {
  const file = path.join(ROOT, ...MOI_TABLE_REPO_PATH.split('/'));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

export function priceToIncomeStep(options: PriceToIncomeStepOptions = {}): Step {
  const readMoiTable = options.readMoiTable ?? readCommittedMoiTable;
  return {
    name: 'price-to-income',
    run(ctx, state) {
      const load = (state.lvrSales ??= loadLvr(ctx, 'sale'));
      const { fia, dgbas } = readIncomeFiles(ctx);
      const income = buildIncomeUnrounded(fia, dgbas, ctx.districts, ctx.quarters).city;
      const series = buildPriceToIncome(load.qualifying, income, ctx.districts, ctx.quarters);
      state.priceToIncomeRatio = series;
      const text = readMoiTable();
      if (text === undefined) state.notes.push(skippedNote());
      else state.notes.push(...comparePriceToIncome(series, parseMoiPriceToIncome(text, MOI_TABLE_REPO_PATH), ctx.quarters));
    },
  };
}
