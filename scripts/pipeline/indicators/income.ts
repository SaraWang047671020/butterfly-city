/**
 * Income indicators (Requirement 7).
 *
 *   rel(d, y)  = FIAmedian(d, y) / median{ FIAmedian(d', y) : d' in the city of d }      y = 2014..2023 (one file each)
 *   rel(d, y)  = a_d + b_d * y, (a_d, b_d) = linearFit(2019..2023)                         y = 2024, 2025
 *   relativeMedianIncome(d, q) = annualToQuarterly(rel(d, 2014..2025))(q)
 *   cityDisposableIncome(c, q) = annualToQuarterly(DGBAS 9415 city income, 2014..2025)(q)
 *   householdIncome(d, q)      = cityDisposableIncome(city of d, q) * relativeMedianIncome(d, q)
 *
 * FIA file `{103..112}_165-9.csv` covers income year 1911 + the ROC prefix (103 -> 2014 ... 112 -> 2023).
 * The 2014 value and the DGBAS 2014 value are only the left neighbour of 2015 for the interpolation. A missing
 * DGBAS 2014 row is tolerated (2015 is then a first year with a flat slope); every year 2015..2025 is required.
 *
 * All values are computed unrounded and rounded once at the end to the decimals of the indicator spec.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { City } from '../../lib/districts.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { annualToQuarterly } from '../interpolate.ts';
import { linearFit, median, roundTo } from '../numeric.ts';
import { parseDgbasDisposableIncome, parseFiaDistrictTotals, type DgbasCityIncomeRow, type FiaDistrictRow } from '../parsers/income.ts';
import { INDICATOR_SPECS } from '../registry/indicators.ts';
import type { Step } from '../run.ts';
import type { CitySeries, DistrictSeries } from './series.ts';

export const FIA_FIRST_YEAR = 2014;
export const FIA_LAST_YEAR = 2023;
/** First year of the extrapolation fit window (2019..2023). */
export const FIT_FIRST_YEAR = 2019;
export const LAST_YEAR = 2025;

const CITIES: readonly City[] = ['Taipei', 'New Taipei'];

export interface DistrictRefWithCity {
  readonly code: string;
  readonly city: City;
}

/** FIA file name and income year pairs: 103_165-9.csv -> 2014, ..., 112_165-9.csv -> 2023. */
export function fiaFiles(): { readonly path: string; readonly incomeYear: number }[] {
  const out: { path: string; incomeYear: number }[] = [];
  for (let y = FIA_FIRST_YEAR; y <= FIA_LAST_YEAR; y++) out.push({ path: `income/${y - 1911}_165-9.csv`, incomeYear: y });
  return out;
}

export const DGBAS_PATH = 'income/dgbas-9415-disposable-income-by-region.csv';

/**
 * rel(d, y) for y = 2014..2023, unrounded. `rowsByYear` maps income year to the parsed district total rows.
 * Throws DataError for a missing year, a missing district row, or a median that is not greater than 0.
 */
export function relativeIncomeByYear(
  rowsByYear: ReadonlyMap<number, readonly FiaDistrictRow[]>,
  districts: readonly DistrictRefWithCity[],
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>(districts.map((d) => [d.code, new Map<number, number>()]));
  for (let year = FIA_FIRST_YEAR; year <= FIA_LAST_YEAR; year++) {
    const rows = rowsByYear.get(year);
    if (rows === undefined) throw new DataError('missing-fia-year', `income year ${year}`, ['no FIA rows for this income year']);
    const medians = new Map<string, number>();
    for (const r of rows) if (!medians.has(r.districtCode)) medians.set(r.districtCode, r.median);
    const missing = districts.filter((d) => !medians.has(d.code)).map((d) => `district ${d.code} income year ${year}: no total row`);
    if (missing.length > 0) throw new DataError('missing-district-income', `income year ${year}`, missing);
    const bad = districts
      .filter((d) => {
        const m = medians.get(d.code) as number;
        return !Number.isFinite(m) || m <= 0;
      })
      .map((d) => `district ${d.code} income year ${year}: median ${String(medians.get(d.code))}`);
    if (bad.length > 0) throw new DataError('non-positive-median', `income year ${year}`, bad);
    for (const city of CITIES) {
      const members = districts.filter((d) => d.city === city);
      const cityMedian = median(members.map((d) => medians.get(d.code) as number));
      for (const d of members) out.get(d.code)!.set(year, (medians.get(d.code) as number) / cityMedian);
    }
  }
  return out;
}

/** Adds rel(d, 2024) and rel(d, 2025) from the OLS line over 2019..2023 only. Returns new maps. */
export function extendRelativeIncome(rel: ReadonlyMap<string, ReadonlyMap<number, number>>): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const xs: number[] = [];
  for (let y = FIT_FIRST_YEAR; y <= FIA_LAST_YEAR; y++) xs.push(y);
  for (const [code, years] of rel) {
    const ys = xs.map((y) => years.get(y) as number);
    const { slope, intercept } = linearFit(xs, ys);
    const full = new Map(years);
    for (let y = FIA_LAST_YEAR + 1; y <= LAST_YEAR; y++) {
      const v = intercept + slope * y;
      if (!(v > 0)) throw new DataError('non-positive-extrapolation', `district ${code} income year ${y}`, [`extrapolated relative income ${String(v)}`]);
      full.set(y, v);
    }
    out.set(code, full);
  }
  return out;
}

/** DGBAS annual city income, 2014..2025 where present. Throws `missing-dgbas-year` for an absent year in 2015..2025. */
export function dgbasAnnual(rows: readonly DgbasCityIncomeRow[]): Map<City, Map<number, number>> {
  const out = new Map<City, Map<number, number>>(CITIES.map((c) => [c, new Map<number, number>()]));
  for (const r of rows) {
    if (r.year < FIA_FIRST_YEAR || r.year > LAST_YEAR) continue;
    if (!out.get('Taipei')!.has(r.year)) {
      out.get('Taipei')!.set(r.year, r.taipei);
      out.get('New Taipei')!.set(r.year, r.newTaipei);
    }
  }
  const problems: string[] = [];
  for (const city of CITIES) {
    for (let y = 2015; y <= LAST_YEAR; y++) {
      const v = out.get(city)!.get(y);
      if (v === undefined || !Number.isFinite(v) || v <= 0) problems.push(`${city} ${y}`);
    }
  }
  if (problems.length > 0) throw new DataError('missing-dgbas-year', problems.join(', '), problems.map((p) => `no DGBAS disposable income for ${p}`));
  for (const city of CITIES) {
    const v = out.get(city)!.get(2014);
    if (v !== undefined && !(v > 0)) out.get(city)!.delete(2014);
  }
  return out;
}

export interface UnroundedIncome {
  /** Unrounded quarterly city disposable income. */
  readonly city: ReadonlyMap<City, ReadonlyMap<Quarter, number>>;
  /** Unrounded quarterly relative median income per district code. */
  readonly relative: ReadonlyMap<string, ReadonlyMap<Quarter, number>>;
  /** Unrounded quarterly household income per district code. */
  readonly household: ReadonlyMap<string, ReadonlyMap<Quarter, number>>;
}

/** All income values before rounding; the 44 requested quarters only. */
export function buildIncomeUnrounded(
  fiaRowsByYear: ReadonlyMap<number, readonly FiaDistrictRow[]>,
  dgbasRows: readonly DgbasCityIncomeRow[],
  districts: readonly DistrictRefWithCity[],
  quarters: readonly Quarter[],
): UnroundedIncome {
  const annualCity = dgbasAnnual(dgbasRows);
  const relAnnual = extendRelativeIncome(relativeIncomeByYear(fiaRowsByYear, districts));

  const city = new Map<City, Map<Quarter, number>>();
  for (const c of CITIES) {
    const all = annualToQuarterly(annualCity.get(c) as Map<number, number>);
    city.set(c, new Map(quarters.map((q) => [q, all.get(q) as number])));
  }
  const relative = new Map<string, Map<Quarter, number>>();
  const household = new Map<string, Map<Quarter, number>>();
  for (const d of districts) {
    const all = annualToQuarterly(relAnnual.get(d.code) as Map<number, number>);
    const rel = new Map(quarters.map((q) => [q, all.get(q) as number] as const));
    relative.set(d.code, rel);
    const cityQ = city.get(d.city) as Map<Quarter, number>;
    household.set(d.code, new Map(quarters.map((q) => [q, (cityQ.get(q) as number) * (rel.get(q) as number)] as const)));
  }
  return { city, relative, household };
}

function decimalsOf(id: string): number {
  const spec = INDICATOR_SPECS.find((s) => s.id === id);
  if (spec === undefined) throw new Error(`indicator spec not found: ${id}`);
  return spec.decimals;
}

export interface IncomeSeries {
  readonly cityDisposableIncome: CitySeries;
  readonly relativeMedianIncome: DistrictSeries;
  readonly householdIncome: DistrictSeries;
}

/** Builds the three income series: unrounded values rounded once, every record estimated with its method id. */
export function buildIncome(
  fiaRowsByYear: ReadonlyMap<number, readonly FiaDistrictRow[]>,
  dgbasRows: readonly DgbasCityIncomeRow[],
  districts: readonly DistrictRefWithCity[],
  quarters: readonly Quarter[],
): IncomeSeries {
  const u = buildIncomeUnrounded(fiaRowsByYear, dgbasRows, districts, quarters);
  const cityDec = decimalsOf('cityDisposableIncome');
  const relDec = decimalsOf('relativeMedianIncome');
  const hhDec = decimalsOf('householdIncome');
  const rec = (value: number, decimals: number, method: string): ValueRecord => ({ value: roundTo(value, decimals), estimated: true, method });
  const relMethod = (q: Quarter): string => (Number(q.slice(0, 4)) > FIA_LAST_YEAR ? 'income-relative-extrapolation' : 'interp-annual-quarterly');

  const cityDisposableIncome: CitySeries = { Taipei: [], 'New Taipei': [] };
  for (const c of CITIES) {
    for (const q of quarters) cityDisposableIncome[c].push(rec(u.city.get(c)!.get(q) as number, cityDec, 'interp-annual-quarterly'));
  }
  const relativeMedianIncome: DistrictSeries = {};
  const householdIncome: DistrictSeries = {};
  for (const d of districts) {
    relativeMedianIncome[d.code] = quarters.map((q) => rec(u.relative.get(d.code)!.get(q) as number, relDec, relMethod(q)));
    householdIncome[d.code] = quarters.map((q) => rec(u.household.get(d.code)!.get(q) as number, hhDec, 'income-district-combination'));
  }
  return { cityDisposableIncome, relativeMedianIncome, householdIncome };
}

/** Reads and parses the ten FIA files and the DGBAS table. */
export function readIncomeFiles(ctx: BuildContext): { fia: Map<number, FiaDistrictRow[]>; dgbas: DgbasCityIncomeRow[] } {
  const fia = new Map<number, FiaDistrictRow[]>();
  for (const f of fiaFiles()) {
    fia.set(f.incomeYear, parseFiaDistrictTotals(ctx.reader.readText(f.path), ctx.reader.display(f.path), f.incomeYear));
  }
  const dgbas = parseDgbasDisposableIncome(ctx.reader.readText(DGBAS_PATH), ctx.reader.display(DGBAS_PATH));
  return { fia, dgbas };
}

export function incomeStep(): Step {
  return {
    name: 'income',
    run(ctx, state) {
      const { fia, dgbas } = readIncomeFiles(ctx);
      const built = buildIncome(fia, dgbas, ctx.districts, ctx.quarters);
      state.cityDisposableIncome = built.cityDisposableIncome;
      state.relativeMedianIncome = built.relativeMedianIncome;
      state.householdIncome = built.householdIncome;
    },
  };
}
