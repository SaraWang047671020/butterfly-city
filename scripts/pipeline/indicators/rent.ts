/**
 * Rent indicator (Requirement 9).
 *
 * Districts with at least 30 qualifying rental records in 2015Q1..2025Q4 (method `rent-relative-cpi`):
 *
 *   p(r)       = rent / area                              per record
 *   rel(d)     = median{ p in d } / median{ p in city c }  all quarters pooled
 *   base(c)    = median{ p in c, lease quarter in 2024 }
 *   cpiQ(c, q) = mean of the three monthly rent sub-index values of q
 *   cpi2024(c) = mean of cpiQ(c, 2024Q1..2024Q4)
 *   rent(d, q) = rel(d) * base(c) * cpiQ(c, q) / cpi2024(c)
 *
 * Every record is estimated, also for districts with enough records (Decision D16).
 *
 * Districts with fewer records use the fixed reference table (`tables/rent-reference.ts`):
 *
 *   rent(d, q) = rent(ref, q) * ratio(d)       rent(ref, q) is the UNROUNDED value
 *   ratioStats(d) = P50(d) / P50(ref)          when both districts are in the MOI rent statistics
 *   ratioSale(d)  = mean(salePrice(d, 2024Q1..Q4)) / mean(salePrice(ref, 2024Q1..Q4))   unrounded sale prices
 *
 * Values are rounded once at the end to the decimals of the `rent` indicator spec.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { City } from '../../lib/districts.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { adjacency } from '../geo.ts';
import { mean, median, roundTo } from '../numeric.ts';
import { parseDgbasCpiRent, parseTaipeiCpiRent, type CpiRentRow } from '../parsers/cpi.ts';
import type { LvrRecord } from '../parsers/lvr.ts';
import { parseRentStats, type RentStatsRow } from '../parsers/rent-stats.ts';
import { INDICATOR_SPECS } from '../registry/indicators.ts';
import type { Step } from '../run.ts';
import { checkCpiMapping, cpiSeriesFor } from '../tables/cpi-series.ts';
import {
  MIN_RENT_RECORDS,
  checkReferenceTable,
  ratioMethodFor,
  type ReferenceRelation,
  type RentReferenceEntry,
} from '../tables/rent-reference.ts';
import { readAllShapes } from '../districts-file.ts';
import { buildSalePrice } from './sale-price.ts';
import { exclusionNotes, loadLvr } from './lvr-input.ts';
import type { DistrictSeries } from './series.ts';

export const RENT_CPI_METHOD = 'rent-relative-cpi';
export const RENT_STATS_METHOD = 'rent-reference-stats';
export const RENT_SALE_RATIO_METHOD = 'rent-reference-sale-ratio';
export const RENT_BASE_YEAR = 2024;
export const RENT_STATS_PATH = 'rent-stats/1140123全國行政區租金統計-修正.ods';
export const TAIPEI_CPI_PATH = 'macro/taipei-A21000102-cpi-monthly.csv';
export const DGBAS_CPI_PATH = 'macro/dgbas-pr0101a1m-cpi-basic.xml';

export interface RentDistrict {
  readonly code: string;
  readonly city: City;
}

export interface RentInput {
  /** Qualifying rental records (filter applied, de-duplicated). */
  readonly rentals: readonly LvrRecord[];
  readonly districts: readonly RentDistrict[];
  readonly quarters: readonly Quarter[];
  /** Monthly rent sub-index rows per city series. */
  readonly cpi: Readonly<Record<City, readonly CpiRentRow[]>>;
  /** Replaces the required city to series assignment; used by tests of Requirement 9.10. */
  readonly cpiMapping?: Readonly<Partial<Record<City, string>>>;
  readonly stats: readonly RentStatsRow[];
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  /** District code -> 44 unrounded sale prices (quarter order). Needed only for sale-price ratios. */
  readonly salePriceUnrounded?: ReadonlyMap<string, readonly number[]>;
  readonly referenceTable?: Readonly<Record<string, RentReferenceEntry>>;
}

/** One used reference entry, for SOURCES.md (Requirement 9.6). */
export interface RentReferenceInfo {
  readonly district: string;
  readonly reference: string;
  readonly relation: ReferenceRelation;
  readonly secondRule: boolean;
  readonly recordCount: number;
  readonly method: typeof RENT_STATS_METHOD | typeof RENT_SALE_RATIO_METHOD;
  readonly ratio: number;
}

export interface RentResult {
  readonly series: DistrictSeries;
  readonly references: readonly RentReferenceInfo[];
  /** Notes about unused table entries. */
  readonly notes: readonly string[];
}

function rentDecimals(): number {
  const spec = INDICATOR_SPECS.find((s) => s.id === 'rent');
  if (spec === undefined) throw new Error('indicator spec not found: rent');
  return spec.decimals;
}

/** `YYYY-MM` months of a quarter. */
export function monthsOf(quarter: Quarter): [string, string, string] {
  const year = quarter.slice(0, 4);
  const q = Number(quarter.slice(5));
  const m = (n: number) => `${year}-${String(n).padStart(2, '0')}`;
  return [m(q * 3 - 2), m(q * 3 - 1), m(q * 3)];
}

/**
 * Quarterly CPI of one city: mean of the three monthly values of each quarter. Stops with the series and the
 * month when any month of the period is missing (Requirement 9.9).
 */
export function quarterlyCpi(city: City, rows: readonly CpiRentRow[], quarters: readonly Quarter[]): number[] {
  const byMonth = new Map(rows.map((r) => [r.yearMonth, r.value]));
  return quarters.map((q) =>
    mean(
      monthsOf(q).map((month) => {
        const v = byMonth.get(month);
        if (v === undefined || !Number.isFinite(v) || !(v > 0)) {
          throw new DataError('missing-cpi-month', `${cpiSeriesFor(city)} ${month}`, [
            `series: ${cpiSeriesFor(city)} (${city})`,
            `month: ${month}`,
          ]);
        }
        return v;
      }),
    ),
  );
}

/** Builds the rent series of all districts. Throws DataError on any broken rule. */
export function buildRent(input: RentInput): RentResult {
  const { rentals, districts, quarters } = input;
  const decimals = rentDecimals();
  checkCpiMapping(districts, input.cpiMapping);

  const cities: readonly City[] = ['Taipei', 'New Taipei'];
  const cityOf = new Map(districts.map((d) => [d.code, d.city]));
  const quarterIndex = new Map(quarters.map((q, i) => [q, i]));
  const cpiQ = new Map<City, number[]>(cities.map((c) => [c, quarterlyCpi(c, input.cpi[c], quarters)]));
  const baseQuarters = quarters.map((q, i) => ({ q, i })).filter((x) => x.q.startsWith(`${RENT_BASE_YEAR}Q`));
  if (baseQuarters.length !== 4) throw new DataError('missing-base-year', String(RENT_BASE_YEAR), ['the base year needs four quarters']);

  // p(r) per district, and per city for the base year.
  const byDistrict = new Map<string, number[]>(districts.map((d) => [d.code, []]));
  const byCity = new Map<City, number[]>(cities.map((c) => [c, []]));
  const byCityBase = new Map<City, number[]>(cities.map((c) => [c, []]));
  for (const r of rentals) {
    if (r.districtCode === undefined || r.quarter === undefined || !(r.area > 0) || !(r.rent > 0)) continue;
    const city = cityOf.get(r.districtCode);
    const qi = quarterIndex.get(r.quarter);
    if (city === undefined || qi === undefined) continue;
    const p = r.rent / r.area;
    byDistrict.get(r.districtCode)?.push(p);
    byCity.get(city)?.push(p);
    if (r.quarter.startsWith(`${RENT_BASE_YEAR}Q`)) byCityBase.get(city)?.push(p);
  }
  const recordCounts = new Map([...byDistrict].map(([code, list]) => [code, list.length]));

  const { used, notes } = checkReferenceTable({
    recordCounts,
    adjacency: input.adjacency,
    districts,
    ...(input.referenceTable === undefined ? {} : { table: input.referenceTable }),
  });

  // Own-record districts.
  const unrounded = new Map<string, number[]>();
  const method = new Map<string, string>();
  for (const d of districts) {
    const list = byDistrict.get(d.code) as number[];
    if (list.length < MIN_RENT_RECORDS) continue;
    const cityList = byCity.get(d.city) as number[];
    const baseList = byCityBase.get(d.city) as number[];
    if (baseList.length === 0) {
      throw new DataError('no-base-year-rentals', d.city, [`no qualifying rental record with a lease date in ${RENT_BASE_YEAR}`]);
    }
    const rel = median(list) / median(cityList);
    const base = median(baseList);
    const cpi = cpiQ.get(d.city) as number[];
    const cpi2024 = mean(baseQuarters.map((x) => cpi[x.i] as number));
    unrounded.set(d.code, cpi.map((c) => (rel * base * c) / cpi2024));
    method.set(d.code, RENT_CPI_METHOD);
  }

  // Reference districts.
  const statsByDistrict = new Map(input.stats.map((s) => [s.districtCode, s.p50]));
  const statsSet = new Set(statsByDistrict.keys());
  const references: RentReferenceInfo[] = [];
  const meanSale2024 = (code: string): number => {
    const values = input.salePriceUnrounded?.get(code);
    if (values === undefined || values.length !== quarters.length) {
      throw new DataError('missing-sale-price', code, ['sale price series needed for the rent ratio']);
    }
    return mean(baseQuarters.map((x) => values[x.i] as number));
  };
  for (const u of used) {
    const ref = u.reference;
    const refRent = unrounded.get(ref);
    if (refRent === undefined) throw new DataError('reference-without-rent', u.district, [`reference ${ref} has no rent series`]);
    const m = ratioMethodFor(u.district, ref, statsSet);
    let ratio: number;
    let methodId: RentReferenceInfo['method'];
    if (m === 'rent-statistics') {
      ratio = (statsByDistrict.get(u.district) as number) / (statsByDistrict.get(ref) as number);
      methodId = RENT_STATS_METHOD;
    } else {
      ratio = meanSale2024(u.district) / meanSale2024(ref);
      methodId = RENT_SALE_RATIO_METHOD;
    }
    if (!Number.isFinite(ratio) || !(ratio > 0)) {
      throw new DataError('invalid-rent-ratio', u.district, [`ratio ${String(ratio)} against reference ${ref}`]);
    }
    unrounded.set(u.district, refRent.map((v) => v * ratio));
    method.set(u.district, methodId);
    references.push({ ...u, method: methodId, ratio });
  }

  const series: DistrictSeries = {};
  for (const d of districts) {
    const values = unrounded.get(d.code);
    const methodId = method.get(d.code);
    if (values === undefined || methodId === undefined) throw new DataError('no-rent-series', d.code);
    series[d.code] = values.map((v): ValueRecord => ({ value: roundTo(v, decimals), estimated: true, method: methodId }));
  }
  return { series, references, notes };
}

export function rentStep(): Step {
  return {
    name: 'rent',
    run(ctx: BuildContext, state) {
      const load = (state.lvrRentals ??= loadLvr(ctx, 'rental'));
      const taipei = parseTaipeiCpiRent(ctx.reader.readText(TAIPEI_CPI_PATH), ctx.reader.display(TAIPEI_CPI_PATH));
      const newTaipei = parseDgbasCpiRent(ctx.reader.readText(DGBAS_CPI_PATH), ctx.reader.display(DGBAS_CPI_PATH));
      const stats = parseRentStats(ctx.reader.readBytes(RENT_STATS_PATH), ctx.reader.display(RENT_STATS_PATH));
      const shapes = (state.shapes ??= readAllShapes(ctx).map((r) => ({ code: r.attributes['TOWNCODE'] as string, polygons: r.polygons })));
      let salePriceUnrounded = state.salePriceUnrounded;
      if (salePriceUnrounded === undefined) {
        const sales = (state.lvrSales ??= loadLvr(ctx, 'sale'));
        salePriceUnrounded = buildSalePrice(sales.qualifying, ctx.districts, ctx.quarters).unrounded;
      }
      const result = buildRent({
        rentals: load.qualifying,
        districts: ctx.districts,
        quarters: ctx.quarters,
        cpi: { Taipei: taipei, 'New Taipei': newTaipei },
        stats,
        adjacency: adjacency(shapes),
        salePriceUnrounded,
      });
      state.rent = result.series;
      state.rentReferences = result.references;
      state.notes.push(...exclusionNotes('rental', load.exclusions), ...result.notes);
    },
  };
}
