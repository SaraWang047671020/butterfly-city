/**
 * Migration indicators (Requirement 6): registered move-ins and move-outs per district and quarter.
 *
 *   in(d, m)  = sum of (in_total_m + in_total_f) over the villages of d in month m
 *   out(d, m) = sum of (out_total_m + out_total_f) over the villages of d in month m
 *   quarterly value = sum of the three monthly values
 *
 * Month to file table (months are ROC `yyymm`; paths relative to data/raw/):
 *   2015-12..2017-12 (10412..10612)  population/ris/ODRP002-{yyymm}.csv                (national CSV)
 *   2018-01..2025-12 (10701..11412)  population/ris/ODRP011-{yyymm}-{county}.json      (county 臺北市, 新北市)
 *                                    except 2024-08 (11308): population/ris/ODRP011-11308.csv
 *   2015 annual totals               population/taipei-a05002802-cycle4.csv, population/ntpc-124872.csv
 *
 * 2015-01..2015-11 have no monthly file. Per district and per indicator:
 *   R(d) = T2015(d) - value(d, 2015-12)             T2015 = annual total of 2015
 *   w(d) = value(d, 2016-m) for m = 1..11
 *   value(d, 2015-m) = apportion(R(d), w(d))[m - 1]
 * R(d) < 0 stops the build (DataError naming the district, indicator, annual total and December count).
 * A district whose eleven 2016 weights are all zero gets an equal split (the `apportion` rule for all-zero
 * weights), so R(d) is still conserved. Quarters 2015Q1..2015Q4 contain at least one split month and are
 * `estimated: true` with method `migration-2015-seasonal-split`; later quarters are `estimated: false`.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { apportion } from '../numeric.ts';
import {
  parseNewTaipeiAnnualMigration,
  parseTaipeiAnnualMigration,
  type AnnualMigrationRow,
} from '../parsers/migration-annual.ts';
import { parseMigrationCsv, parseMigrationJson, type MigrationVillageRow } from '../parsers/household.ts';
import type { Step } from '../run.ts';
import { checkCount, quarterMonths, rocMonthKey, type CodeRef, type DistrictSeries } from './series.ts';
import type { MonthFile } from './population.ts';

export const MIGRATION_SPLIT_METHOD = 'migration-2015-seasonal-split';
const COUNTIES = ['臺北市', '新北市'] as const;
const LAST_ODRP002_MONTH = '10612';
const ODRP011_CSV_MONTHS: ReadonlySet<string> = new Set(['11308']);
const SPLIT_YEAR = 2015;
const DECEMBER_2015 = rocMonthKey(SPLIT_YEAR, 12);

export const TAIPEI_ANNUAL_FILE = 'population/taipei-a05002802-cycle4.csv';
export const NEW_TAIPEI_ANNUAL_FILE = 'population/ntpc-124872.csv';

/** Files that hold the migration of one ROC month (`yyymm`). */
export function migrationFiles(month: string): MonthFile[] {
  if (month <= LAST_ODRP002_MONTH) return [{ path: `population/ris/ODRP002-${month}.csv`, format: 'csv' }];
  if (ODRP011_CSV_MONTHS.has(month)) return [{ path: `population/ris/ODRP011-${month}.csv`, format: 'csv' }];
  return COUNTIES.map((c) => ({ path: `population/ris/ODRP011-${month}-${c}.json`, format: 'json' as const }));
}

/** True for the months of 2015 that have no monthly file (2015-01..2015-11). */
function isSplitMonth(month: string): boolean {
  return month.startsWith(String(SPLIT_YEAR - 1911)) && month < DECEMBER_2015;
}

/** ROC months to read: every month of the quarters, except split months, plus the 2016 weight months if needed. */
export function migrationMonths(quarters: readonly Quarter[]): string[] {
  const wanted = new Set<string>();
  let needsSplit = false;
  for (const q of quarters) {
    for (const m of quarterMonths(q)) {
      if (isSplitMonth(m)) needsSplit = true;
      else wanted.add(m);
    }
  }
  if (needsSplit) {
    wanted.add(DECEMBER_2015);
    for (let m = 1; m <= 11; m++) wanted.add(rocMonthKey(SPLIT_YEAR + 1, m));
  }
  return [...wanted].sort();
}

interface Monthly {
  readonly moveIn: Map<string, number>;
  readonly moveOut: Map<string, number>;
}

export interface MigrationSeries {
  readonly moveIn: DistrictSeries;
  readonly moveOut: DistrictSeries;
}

function aggregate(month: string, rows: readonly MigrationVillageRow[] | undefined, districts: readonly CodeRef[]): Monthly {
  if (rows === undefined || rows.length === 0) {
    throw new DataError('missing-month', `migration ${month}`, ['no village rows for this month']);
  }
  const moveIn = new Map<string, number>();
  const moveOut = new Map<string, number>();
  for (const r of rows) {
    const where = `migration ${month} district ${r.districtCode} village ${r.village}`;
    if (r.month !== month) throw new DataError('month-mismatch', `migration ${month}`, [`district ${r.districtCode} village ${r.village}: row month ${r.month}`]);
    const i = checkCount(r.inMale, 'invalid-count', where) + checkCount(r.inFemale, 'invalid-count', where);
    const o = checkCount(r.outMale, 'invalid-count', where) + checkCount(r.outFemale, 'invalid-count', where);
    moveIn.set(r.districtCode, (moveIn.get(r.districtCode) ?? 0) + i);
    moveOut.set(r.districtCode, (moveOut.get(r.districtCode) ?? 0) + o);
  }
  for (const d of districts) {
    if (!moveIn.has(d.code)) {
      throw new DataError('missing-district-month', `migration ${month} district ${d.code}`, ['no village rows for this district']);
    }
  }
  return { moveIn, moveOut };
}

type Indicator = 'moveIn' | 'moveOut';

/** Monthly values of 2015-01..2015-11 for one district and indicator. */
function splitRemainder(
  indicator: Indicator,
  code: string,
  annualTotal: number,
  december: number,
  weights: readonly number[],
): number[] {
  const remainder = annualTotal - december;
  if (remainder < 0) {
    throw new DataError('negative-remainder', `district ${code} ${indicator}`, [
      `annual total 2015: ${annualTotal}`,
      `2015-12 count: ${december}`,
    ]);
  }
  return apportion(remainder, weights);
}

/**
 * Builds the moveIn and moveOut series. `monthly` maps ROC `yyymm` to parsed village rows; `annual2015` holds
 * the annual 2015 totals per district (both cities together).
 */
export function buildMigration(
  monthly: ReadonlyMap<string, readonly MigrationVillageRow[]>,
  annual2015: readonly AnnualMigrationRow[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): MigrationSeries {
  const cache = new Map<string, Monthly>();
  const real = (month: string): Monthly => {
    let m = cache.get(month);
    if (m === undefined) {
      m = aggregate(month, monthly.get(month), districts);
      cache.set(month, m);
    }
    return m;
  };

  // 2015-01..2015-11 per indicator and district, only when a requested quarter needs them.
  const split = new Map<string, number[]>(); // key `${indicator}|${code}` -> 11 values
  if (quarters.some((q) => quarterMonths(q).some(isSplitMonth))) {
    const annual = new Map(annual2015.map((r) => [r.districtCode, r]));
    const dec = real(DECEMBER_2015);
    const weightMonths = Array.from({ length: 11 }, (_, i) => real(rocMonthKey(SPLIT_YEAR + 1, i + 1)));
    for (const d of districts) {
      const a = annual.get(d.code);
      if (a === undefined) throw new DataError('missing-annual-total', `district ${d.code}`, [`no 2015 annual migration row`]);
      for (const indicator of ['moveIn', 'moveOut'] as const) {
        const total = checkCount(indicator === 'moveIn' ? a.moveIn : a.moveOut, 'invalid-count', `annual 2015 district ${d.code} ${indicator}`);
        const weights = weightMonths.map((m) => m[indicator].get(d.code) ?? 0);
        split.set(`${indicator}|${d.code}`, splitRemainder(indicator, d.code, total, dec[indicator].get(d.code) ?? 0, weights));
      }
    }
  }

  const monthValue = (indicator: Indicator, code: string, month: string): number => {
    if (isSplitMonth(month)) return split.get(`${indicator}|${code}`)![Number(month.slice(-2)) - 1]!;
    return real(month)[indicator].get(code) ?? 0;
  };

  const moveIn: DistrictSeries = Object.fromEntries(districts.map((d) => [d.code, [] as ValueRecord[]]));
  const moveOut: DistrictSeries = Object.fromEntries(districts.map((d) => [d.code, [] as ValueRecord[]]));
  for (const q of quarters) {
    const months = quarterMonths(q);
    const estimated = months.some(isSplitMonth);
    for (const d of districts) {
      for (const [indicator, target] of [['moveIn', moveIn], ['moveOut', moveOut]] as const) {
        const value = months.reduce((s, m) => s + monthValue(indicator, d.code, m), 0);
        const record: ValueRecord = estimated
          ? { value, estimated: true, method: MIGRATION_SPLIT_METHOD }
          : { value, estimated: false };
        target[d.code]!.push(record);
      }
    }
  }
  return { moveIn, moveOut };
}

/** Reads and parses the migration files of the given months. */
export function readMigrationMonths(ctx: BuildContext, months: readonly string[]): Map<string, MigrationVillageRow[]> {
  const out = new Map<string, MigrationVillageRow[]>();
  for (const month of months) {
    const rows: MigrationVillageRow[] = [];
    for (const f of migrationFiles(month)) {
      const text = ctx.reader.readText(f.path);
      const shown = ctx.reader.display(f.path);
      rows.push(...(f.format === 'csv' ? parseMigrationCsv(text, shown) : parseMigrationJson(text, shown)));
    }
    out.set(month, rows);
  }
  return out;
}

/** Reads the two annual 2015 tables. */
export function readAnnual2015(ctx: BuildContext): AnnualMigrationRow[] {
  const t = ctx.reader.display(TAIPEI_ANNUAL_FILE);
  const n = ctx.reader.display(NEW_TAIPEI_ANNUAL_FILE);
  return [
    ...parseTaipeiAnnualMigration(ctx.reader.readText(TAIPEI_ANNUAL_FILE), t, SPLIT_YEAR),
    ...parseNewTaipeiAnnualMigration(ctx.reader.readText(NEW_TAIPEI_ANNUAL_FILE), n, SPLIT_YEAR),
  ];
}

export function migrationStep(): Step {
  return {
    name: 'migration',
    run(ctx, state) {
      const monthly = readMigrationMonths(ctx, migrationMonths(ctx.quarters));
      const needsAnnual = ctx.quarters.some((q) => quarterMonths(q).some(isSplitMonth));
      const built = buildMigration(monthly, needsAnnual ? readAnnual2015(ctx) : [], ctx.districts, ctx.quarters);
      state.moveIn = built.moveIn;
      state.moveOut = built.moveOut;
    },
  };
}
