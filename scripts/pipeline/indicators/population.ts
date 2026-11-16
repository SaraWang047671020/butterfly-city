/**
 * Population indicator (Requirement 5): registered residents per district at the end of each quarter.
 *
 *   population(d, q) = sum of people_total over the village rows of d in the file of the last month of q.
 *
 * Month to file table (months are ROC `yyymm`; paths relative to data/raw/):
 *   2015-01..2017-12 (10401..10612)  population/ris/ODRP005-{yyymm}.csv                (national CSV)
 *   2018-03..2025-12 (10703..11412)  population/ris/ODRP014-{yyymm}-{county}.json      (county 臺北市, 新北市)
 * Only last-of-quarter months are read. The builder is pure: it takes parsed rows keyed by month.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { parsePopulationCsv, parsePopulationJson, type PopulationVillageRow } from '../parsers/household.ts';
import type { Step } from '../run.ts';
import { checkCount, quarterMonths, type CodeRef, type DistrictSeries } from './series.ts';

const COUNTIES = ['臺北市', '新北市'] as const;

/** Last ROC month served by ODRP005; later months come from ODRP014. */
const LAST_ODRP005_MONTH = '10612';

export interface MonthFile {
  readonly path: string;
  readonly format: 'csv' | 'json';
}

/** Files that hold the population of one ROC month (`yyymm`). */
export function populationFiles(month: string): MonthFile[] {
  if (month <= LAST_ODRP005_MONTH) return [{ path: `population/ris/ODRP005-${month}.csv`, format: 'csv' }];
  return COUNTIES.map((c) => ({ path: `population/ris/ODRP014-${month}-${c}.json`, format: 'json' as const }));
}

/** The last month of each quarter, in quarter order. */
export function populationMonths(quarters: readonly Quarter[]): string[] {
  return quarters.map((q) => quarterMonths(q)[2]);
}

/**
 * Builds the population series. `rowsByMonth` maps ROC `yyymm` to the parsed rows of that month's file(s).
 * Throws DataError for a month without rows, a district without rows in a month, a row whose month differs
 * from its key, or a people_total that is not a non-negative integer.
 */
export function buildPopulation(
  rowsByMonth: ReadonlyMap<string, readonly PopulationVillageRow[]>,
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): DistrictSeries {
  const series: DistrictSeries = Object.fromEntries(districts.map((d) => [d.code, [] as ValueRecord[]]));
  for (const month of populationMonths(quarters)) {
    const rows = rowsByMonth.get(month);
    if (rows === undefined || rows.length === 0) {
      throw new DataError('missing-month', `population ${month}`, ['no village rows for this month']);
    }
    const sums = new Map<string, number>();
    for (const r of rows) {
      if (r.month !== month) {
        throw new DataError('month-mismatch', `population ${month}`, [`district ${r.districtCode} village ${r.village}: row month ${r.month}`]);
      }
      const count = checkCount(r.peopleTotal, 'invalid-count', `population ${month} district ${r.districtCode} village ${r.village}`);
      sums.set(r.districtCode, (sums.get(r.districtCode) ?? 0) + count);
    }
    for (const d of districts) {
      const total = sums.get(d.code);
      if (total === undefined) {
        throw new DataError('missing-district-month', `population ${month} district ${d.code}`, ['no village rows for this district']);
      }
      series[d.code]!.push({ value: total, estimated: false });
    }
  }
  return series;
}

/** Reads and parses the population files of the given months. */
export function readPopulationMonths(ctx: BuildContext, months: readonly string[]): Map<string, PopulationVillageRow[]> {
  const out = new Map<string, PopulationVillageRow[]>();
  for (const month of months) {
    const rows: PopulationVillageRow[] = [];
    for (const f of populationFiles(month)) {
      const text = ctx.reader.readText(f.path);
      const shown = ctx.reader.display(f.path);
      rows.push(...(f.format === 'csv' ? parsePopulationCsv(text, shown) : parsePopulationJson(text, shown)));
    }
    out.set(month, rows);
  }
  return out;
}

export function populationStep(): Step {
  return {
    name: 'population',
    run(ctx, state) {
      const rows = readPopulationMonths(ctx, populationMonths(ctx.quarters));
      state.population = buildPopulation(rows, ctx.districts, ctx.quarters);
    },
  };
}
