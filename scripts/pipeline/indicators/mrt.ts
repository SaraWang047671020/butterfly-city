/**
 * MRT entries per district and quarter (Requirement 11).
 *
 * Pure builder `buildMrtEntries` plus the thin step `mrtStep`. For each station row of the annual series:
 *  - district = the district containing the TDX station point (point-in-polygon, Requirement 11.1);
 *  - seasonal shares = mean over the full years of 2015–2016 of (daily entries in quarter k) / (entries in the
 *    year), or the shares of the comparable station when no full year exists (11.6, 11.8);
 *  - a row is active in a quarter when it appears in the annual series and `opened` is on or before the last
 *    day of the quarter (11.4);
 *  - quarterly entries = `apportion(annual entries, weights)` with weight 0 in inactive quarters, which gives
 *    the opening-year rescaling and the exact annual sum (11.7, 11.13, 11.14).
 * A district with no active row in a quarter gets 0 and `estimated: false`; every other value is estimated with
 * the method `mrt-seasonal-split` (11.9, 11.10).
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { Position } from '../../geo/shapefile.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { DataError, ParseError } from '../errors.ts';
import { districtAt, type DistrictShape } from '../geo.ts';
import { apportion, mean, stableSum } from '../numeric.ts';
import { parseMrtAnnual, parseMrtDailyEntries, type MrtAnnualRow, type MrtDailyRow } from '../parsers/mrt.ts';
import type { Step } from '../run.ts';
import {
  BORDER_STATIONS,
  checkRowNames,
  MRT_ROWS,
  NON_STATION_ROWS,
  type BorderStation,
  type MrtRowEntry,
} from '../tables/mrt-stations.ts';
import type { CodeRef, DistrictSeries } from './series.ts';

export const MRT_METHOD_ID = 'mrt-seasonal-split';
export const MRT_SHARE_YEARS: readonly number[] = [2015, 2016];
export const MRT_ANNUAL_FILE = 'mrt/taipei-133184-annual-station.csv';
export const MRT_SHARE_TOLERANCE = 1e-9;

/** A merged station point: Chinese station name and [lon, lat]. */
export interface StationPoint {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
}

export interface MrtInput {
  readonly annualRows: readonly MrtAnnualRow[];
  /** Daily rows of all files of 2015–2016 (any order). */
  readonly daily: readonly MrtDailyRow[];
  readonly stationPoints: readonly StationPoint[];
  readonly shapes: readonly DistrictShape[];
  readonly districts: readonly CodeRef[];
  readonly quarters: readonly Quarter[];
  /** Row table; defaults to the committed MRT_ROWS. */
  readonly rows?: readonly MrtRowEntry[];
  /** Border stations for the notes; defaults to BORDER_STATIONS. */
  readonly borderStations?: readonly BorderStation[];
}

export interface MrtResult {
  readonly series: DistrictSeries;
  /** One line per border station used, for SOURCES.md (Requirement 11.1). */
  readonly borderNotes: readonly string[];
  /** One line per row that borrowed seasonal shares, for SOURCES.md (Requirement 11.8). */
  readonly comparableNotes: readonly string[];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Last day of quarter k (1..4) of a year, ISO. */
function quarterEnd(year: number, k: number): string {
  const month = k * 3;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isActiveByDate(row: MrtRowEntry, year: number, k: number): boolean {
  return row.opened === 'before-2015' || row.opened <= quarterEnd(year, k);
}

function isFullYear(row: MrtRowEntry, year: number): boolean {
  return row.opened === 'before-2015' || row.opened <= `${year}-01-01`;
}

/** Daily entries summed per station column, year and quarter: name -> year -> [Q1..Q4]. */
function dailyQuarterSums(daily: readonly MrtDailyRow[]): Map<string, Map<number, number[]>> {
  const out = new Map<string, Map<number, number[]>>();
  for (const day of daily) {
    const year = Number(day.date.slice(0, 4));
    const k = Math.ceil(Number(day.date.slice(5, 7)) / 3) - 1;
    for (const [name, n] of day.entries) {
      let byYear = out.get(name);
      if (byYear === undefined) out.set(name, (byYear = new Map()));
      let sums = byYear.get(year);
      if (sums === undefined) byYear.set(year, (sums = [0, 0, 0, 0]));
      sums[k] = sums[k]! + n;
    }
  }
  return out;
}

/** Shares of one row from its own full years, or undefined when it has none (or no daily column). */
function ownShares(
  row: MrtRowEntry,
  sums: ReadonlyMap<string, ReadonlyMap<number, readonly number[]>>,
): number[] | undefined {
  if (row.dailyName === undefined) return undefined;
  const years = MRT_SHARE_YEARS.filter((y) => isFullYear(row, y));
  if (years.length === 0) return undefined;
  const perYear: number[][] = years.map((y) => {
    const q = sums.get(row.dailyName!)?.get(y);
    const total = q === undefined ? 0 : stableSum(q);
    if (q === undefined || total <= 0) {
      throw new DataError('mrt-no-daily-entries', `${row.name} ${y}`, [
        `daily column: ${row.dailyName}`,
        `no daily entries found for a full year (${y}) of this row`,
      ]);
    }
    return q.map((v) => v / total);
  });
  return [0, 1, 2, 3].map((k) => mean(perYear.map((s) => s[k]!)));
}

/** Seasonal shares [Q1..Q4] of one row from its own full years of 2015–2016, or undefined when it has none. */
export function mrtSeasonalShares(row: MrtRowEntry, daily: readonly MrtDailyRow[]): number[] | undefined {
  return ownShares(row, dailyQuarterSums(daily));
}

function checkSharesSum(row: MrtRowEntry, shares: readonly number[]): void {
  const sum = stableSum(shares);
  if (Math.abs(sum - 1) > MRT_SHARE_TOLERANCE) {
    throw new DataError('mrt-share-sum', row.name, [`seasonal shares sum to ${sum}, expected 1 within ${MRT_SHARE_TOLERANCE}`]);
  }
}

export function buildMrtEntries(input: MrtInput): MrtResult {
  const rows = input.rows ?? MRT_ROWS;
  const borderStations = input.borderStations ?? BORDER_STATIONS;
  checkRowNames(input.annualRows, rows);

  const nonStation = new Set(NON_STATION_ROWS);
  const annual = new Map<string, Map<number, number>>();
  for (const r of input.annualRows) {
    if (nonStation.has(r.name)) continue;
    let byYear = annual.get(r.name);
    if (byYear === undefined) annual.set(r.name, (byYear = new Map()));
    byYear.set(r.year, (byYear.get(r.year) ?? 0) + r.entries);
  }

  const sums = dailyQuarterSums(input.daily);
  const points = new Map(input.stationPoints.map((p) => [p.name, p] as const));
  const districtCodes = new Set(input.districts.map((d) => d.code));
  const years = [...new Set(input.quarters.map((q) => Number(q.slice(0, 4))))].sort((a, b) => a - b);

  const index = new Map<string, Map<number, number>>(); // district code -> quarter index -> value
  const quarterIndex = new Map(input.quarters.map((q, i) => [q, i] as const));
  const active = new Set<string>(); // `${code}\0${quarter index}`
  for (const d of input.districts) index.set(d.code, new Map());

  const borderNotes: string[] = [];
  const comparableNotes: string[] = [];
  const usedBorder = new Set<string>();

  for (const row of rows) {
    const byYear = annual.get(row.name);
    if (byYear === undefined) continue; // the row never appears in the annual series: never active

    const point = points.get(row.station);
    if (point === undefined) {
      throw new DataError('mrt-station-point', row.station, [`row: ${row.name}`, 'no TDX station point with this name']);
    }
    const position: Position = [point.lon, point.lat];
    const code = districtAt(position, input.shapes);
    if (code === undefined || !districtCodes.has(code)) {
      throw new DataError('mrt-station-district', row.station, [
        `row: ${row.name}`,
        `point: [${point.lon}, ${point.lat}]`,
        'the station point is inside none of the districts',
      ]);
    }

    let shares = ownShares(row, sums);
    if (shares === undefined) {
      const comparable = row.comparable;
      const source = comparable === undefined ? undefined : rows.find((r) => r.dailyName === comparable && ownShares(r, sums) !== undefined);
      if (comparable === undefined || source === undefined) {
        throw new DataError('mrt-no-seasonal-shares', row.name, [
          'the row has no full year in 2015–2016 and no usable comparable station',
          `comparable: ${comparable ?? '(none)'}`,
        ]);
      }
      shares = ownShares(source, sums)!;
      comparableNotes.push(`${row.name} (${row.station}): seasonal shares of ${comparable}`);
    }
    checkSharesSum(row, shares);

    let rowUsed = false;
    for (const year of years) {
      const quarterActive = [1, 2, 3, 4].map((k) => isActiveByDate(row, year, k));
      if (!quarterActive.some(Boolean)) continue;
      const entries = byYear.get(year);
      if (entries === undefined) {
        throw new DataError('mrt-missing-annual-value', `${row.name} ${year}`, [
          `station row: ${row.name}`,
          `year: ${year}`,
          'the row is active in this year but the annual series has no value',
        ]);
      }
      const weights = shares.map((s, k) => (quarterActive[k] ? s : 0));
      const quarterly = apportion(entries, weights);
      quarterly.forEach((value, k) => {
        if (!quarterActive[k]) return;
        const qi = quarterIndex.get(`${year}Q${k + 1}` as Quarter);
        if (qi === undefined) return;
        rowUsed = true;
        const perQuarter = index.get(code)!;
        perQuarter.set(qi, (perQuarter.get(qi) ?? 0) + value);
        active.add(`${code}\u0000${qi}`);
      });
    }
    if (rowUsed && borderStations.some((b) => b.station === row.station)) usedBorder.add(row.station);
  }

  for (const b of borderStations) {
    if (!usedBorder.has(b.station)) continue;
    borderNotes.push(`${b.nameEn}: station point in ${b.pointDistrict}, address in ${b.addressDistrict}`);
  }

  const series: DistrictSeries = {};
  for (const d of input.districts) {
    const perQuarter = index.get(d.code)!;
    series[d.code] = input.quarters.map((_, qi): ValueRecord =>
      active.has(`${d.code}\u0000${qi}`)
        ? { value: perQuarter.get(qi) ?? 0, estimated: true, method: MRT_METHOD_ID }
        : { value: 0, estimated: false },
    );
  }
  return { series, borderNotes, comparableNotes: [...new Set(comparableNotes)] };
}

interface TdxStationJson {
  readonly StationName?: { readonly Zh_tw?: unknown };
  readonly StationPosition?: { readonly PositionLon?: unknown; readonly PositionLat?: unknown };
}

/**
 * Parses TDX station JSON texts (given in operator order) and merges stations that share a Chinese name
 * (transfer stations) like `mergeByName` of scripts/sources/stations.ts: the first record of a name wins.
 */
export function mergeStationPoints(files: readonly { readonly text: string; readonly file: string }[]): StationPoint[] {
  const byName = new Map<string, StationPoint>();
  for (const { text, file } of files) {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new ParseError(file, undefined, ['JSON array of stations'], [typeof data], 'not an array');
    (data as TdxStationJson[]).forEach((s, i) => {
      const name = s.StationName?.Zh_tw;
      const lon = s.StationPosition?.PositionLon;
      const lat = s.StationPosition?.PositionLat;
      if (typeof name !== 'string' || typeof lon !== 'number' || typeof lat !== 'number') {
        throw new ParseError(file, i + 1, ['StationName.Zh_tw', 'StationPosition.PositionLon/Lat'], Object.keys(s), 'station without name or point');
      }
      const key = name.replace(/站$/, '');
      if (!byName.has(key)) byName.set(key, { name: key, lon, lat });
    });
  }
  return [...byName.values()];
}

export function mrtDailyFiles(): string[] {
  const out: string[] = [];
  for (const y of MRT_SHARE_YEARS) for (let m = 1; m <= 12; m++) out.push(`mrt/daily/taipei-entries-${y}-${pad2(m)}.csv`);
  return out;
}

export function mrtStep(): Step {
  return {
    name: 'mrt',
    run(ctx: BuildContext, state) {
      if (state.shapes === undefined) throw new Error('mrt step needs state.shapes from the districts step');
      const annualRows = parseMrtAnnual(ctx.reader.readText(MRT_ANNUAL_FILE), ctx.reader.display(MRT_ANNUAL_FILE));
      const daily: MrtDailyRow[] = [];
      for (const f of mrtDailyFiles()) {
        daily.push(...parseMrtDailyEntries(ctx.reader.readText(f, 'big5'), ctx.reader.display(f)));
      }
      const stationFiles = ['stations/tdx-station-TRTC.json', 'stations/tdx-station-NTMC.json'];
      const stationPoints = mergeStationPoints(
        stationFiles.map((f) => ({ text: ctx.reader.readText(f), file: ctx.reader.display(f) })),
      );
      const result = buildMrtEntries({
        annualRows,
        daily,
        stationPoints,
        shapes: state.shapes,
        districts: ctx.districts,
        quarters: ctx.quarters,
      });
      state.mrtEntries = result.series;
      state.mrtBorderNotes = result.borderNotes;
      state.mrtComparableNotes = result.comparableNotes;
    },
  };
}
