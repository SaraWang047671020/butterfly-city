/**
 * Backtest_Station_Data reader (Requirements 11.15, 27.19 to 27.23).
 *
 * Reads the monthly Taipei Metro station OD files (`data/raw/mrt/od-station-month/YYYY-MM.json`), keeps entries
 * only, maps each station key to a district and sums entries per district and quarter. It is used only by the
 * TPASS backtest. It is not imported by `src/` or by the data build, and `history.json` is not changed by it.
 */
import { DataError } from '../pipeline/errors.ts';
import { createContext } from '../pipeline/context.ts';
import { checkDistrictCodes, readAllShapes } from '../pipeline/districts-file.ts';
import { mergeStationPoints, stationDistrictMap } from '../pipeline/indicators/mrt.ts';
import type { RawReader } from '../pipeline/raw-reader.ts';
import { MRT_ROWS } from '../pipeline/tables/mrt-stations.ts';

/**
 * Station name -> district code of the station table, by the point-in-polygon assignment of Requirement 11.1
 * (the same function the data build uses). Reads the boundary shapefile and the TDX station files.
 */
export function loadStationDistrict(reader: RawReader): Map<string, string> {
  const ctx = createContext({ reader });
  const shapes = checkDistrictCodes(readAllShapes(ctx)).map((r) => ({ code: r.attributes['TOWNCODE'] as string, polygons: r.polygons }));
  const points = mergeStationPoints(
    ['stations/tdx-station-TRTC.json', 'stations/tdx-station-NTMC.json'].map((f) => ({ text: reader.readText(f), file: reader.display(f) })),
  );
  return stationDistrictMap(points, shapes, ctx.districts);
}

export const OD_DIR = 'mrt/od-station-month';

/** The 24 months of the TPASS backtest: 2019-01..2019-12 and 2023-01..2023-12. */
export const BACKTEST_MONTHS: readonly string[] = [2019, 2023].flatMap((y) =>
  Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`),
);

export interface MissingMonthFile {
  readonly month: string;
  readonly path: string;
  readonly command: string;
}

/** Months whose OD file does not exist, with the displayed path and the download command (Requirement 27.20). */
export function listMissingMonthFiles(reader: Pick<RawReader, 'exists' | 'display'>, months: readonly string[] = BACKTEST_MONTHS): MissingMonthFile[] {
  const out: MissingMonthFile[] = [];
  for (const month of months) {
    const rel = `${OD_DIR}/${month}.json`;
    if (!reader.exists(rel)) out.push({ month, path: reader.display(rel), command: `node scripts/download.ts mrt --od=${month}` });
  }
  return out;
}

export interface MonthlyEntries {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Entries per station key as written in the OD file (may carry a line prefix such as `BL`). */
  readonly entries: ReadonlyMap<string, number>;
  /** The `source` URL of the monthly file; absent in in-memory fixtures. */
  readonly source?: string;
}

/** Quarter key such as `2023Q1`. */
export type QuarterLabel = string;

export interface StationFilterResult {
  /** Station keys with entries in every month. Sorted. */
  readonly included: readonly string[];
  /** Station keys missing or zero in at least one month. Sorted. */
  readonly excluded: readonly string[];
  /** Entries of the excluded stations divided by all entries, over the 2023 months. Null if no 2023 month is read. */
  readonly excludedShare2023: number | null;
}

export interface QuarterlyResult {
  /** District code -> quarter -> entries, stations with entries in all months only. */
  readonly main: ReadonlyMap<string, ReadonlyMap<QuarterLabel, number>>;
  /** Same, all stations. */
  readonly all: ReadonlyMap<string, ReadonlyMap<QuarterLabel, number>>;
  readonly filter: StationFilterResult;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readCounts(month: string, field: string, v: unknown): Map<string, number> {
  if (!isRecord(v)) throw new DataError('mrt-od-shape', month, [`field: ${field}`, 'expected an object of station counts']);
  const out = new Map<string, number>();
  for (const [station, n] of Object.entries(v)) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new DataError('mrt-od-shape', month, [`field: ${field}`, `station: ${station}`, `value: ${String(n)}`, 'expected a finite non-negative number']);
    }
    out.set(station, n);
  }
  return out;
}

/**
 * Reads and validates the monthly files. Stops at the first missing or malformed month and names the month and
 * the field. Returns entries only; exits are validated but not returned.
 */
export function readMonthlyEntries(months: readonly string[], reader: RawReader): MonthlyEntries[] {
  const out: MonthlyEntries[] = [];
  for (const month of months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DataError('mrt-od-month', month, ['expected YYYY-MM']);
    const path = `${OD_DIR}/${month}.json`;
    if (!reader.exists(path)) throw new DataError('mrt-od-missing', month, [`file: ${reader.display(path)}`, `download: node scripts/download.ts mrt --od=${month}`]);
    let raw: unknown;
    try {
      raw = JSON.parse(reader.readText(path, 'utf-8'));
    } catch (e) {
      throw new DataError('mrt-od-shape', month, [`file: ${reader.display(path)}`, `not valid JSON: ${(e as Error).message}`]);
    }
    if (!isRecord(raw)) throw new DataError('mrt-od-shape', month, ['expected a JSON object']);
    if (raw['month'] !== month) throw new DataError('mrt-od-shape', month, ['field: month', `value: ${String(raw['month'])}`, 'does not match the file name']);
    if (typeof raw['source'] !== 'string' || raw['source'] === '') throw new DataError('mrt-od-shape', month, ['field: source', 'expected a non-empty string']);
    const entries = readCounts(month, 'entries', raw['entries']);
    readCounts(month, 'exits', raw['exits']);
    const rows = raw['rows'];
    if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 0) throw new DataError('mrt-od-shape', month, ['field: rows', `value: ${String(rows)}`, 'expected a non-negative integer']);
    out.push({ month, entries, source: raw['source'] });
  }
  return out;
}

/** OD keys that carry a line prefix, mapped to the station name of the station table (Requirement 11.2). */
export const OD_KEY_ALIAS: ReadonlyMap<string, string> = new Map([
  ['BL板橋', '板橋'],
  ['Y板橋', '板橋'],
  ['大橋頭站', '大橋頭'], // the 2025-12 OD file spells the station with a trailing 站
]);

/**
 * Alias table for OD station keys: every station of the existing table `MRT_ROWS` maps to itself, plus
 * `OD_KEY_ALIAS`. Nothing else is guessed; an unknown key stops `quarterlyByDistrict`.
 */
export function defaultAlias(): Map<string, string> {
  const alias = new Map<string, string>();
  for (const r of MRT_ROWS) alias.set(r.station, r.station);
  for (const [k, v] of OD_KEY_ALIAS) alias.set(k, v);
  return alias;
}

function quarterOf(month: string): QuarterLabel {
  return `${month.slice(0, 4)}Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
}

/** Station keys with entries greater than 0 in every month, the others, and the excluded share of 2023 entries. */
export function filterStations(monthly: readonly MonthlyEntries[]): StationFilterResult {
  const keys = new Set<string>();
  for (const m of monthly) for (const k of m.entries.keys()) keys.add(k);
  const included: string[] = [];
  const excluded: string[] = [];
  for (const k of [...keys].sort()) {
    (monthly.every((m) => (m.entries.get(k) ?? 0) > 0) ? included : excluded).push(k);
  }
  const ex = new Set(excluded);
  let total = 0;
  let excl = 0;
  let any = false;
  for (const m of monthly) {
    if (!m.month.startsWith('2023-')) continue;
    any = true;
    for (const [k, n] of m.entries) {
      total += n;
      if (ex.has(k)) excl += n;
    }
  }
  return { included, excluded, excludedShare2023: any && total > 0 ? excl / total : null };
}

function sumByDistrict(
  monthly: readonly MonthlyEntries[],
  keep: (key: string) => boolean,
  stationDistrict: ReadonlyMap<string, string>,
  alias: ReadonlyMap<string, string>,
): Map<string, Map<QuarterLabel, number>> {
  const out = new Map<string, Map<QuarterLabel, number>>();
  for (const m of monthly) {
    const q = quarterOf(m.month);
    for (const [key, n] of m.entries) {
      const station = alias.get(key);
      if (station === undefined) throw new DataError('mrt-od-unknown-station', key, [`month: ${m.month}`, 'no entry in the station alias table']);
      const district = stationDistrict.get(station);
      if (district === undefined) throw new DataError('mrt-od-no-district', key, [`month: ${m.month}`, `station: ${station}`, 'no entry in the station-to-district table']);
      if (!keep(key)) continue;
      let byQ = out.get(district);
      if (byQ === undefined) out.set(district, (byQ = new Map()));
      byQ.set(q, (byQ.get(q) ?? 0) + n);
    }
  }
  return out;
}

/**
 * Sums entries (not exits) per district and quarter. Every quarter that appears must have all 3 months. An OD key
 * with no alias entry stops with the station and the month (Requirement 27.21).
 * `stationDistrict` maps a station name of the station table to a district code.
 */
export function quarterlyByDistrict(
  monthly: readonly MonthlyEntries[],
  stationDistrict: ReadonlyMap<string, string>,
  alias: ReadonlyMap<string, string> = defaultAlias(),
): QuarterlyResult {
  const perQuarter = new Map<QuarterLabel, number>();
  for (const m of monthly) perQuarter.set(quarterOf(m.month), (perQuarter.get(quarterOf(m.month)) ?? 0) + 1);
  for (const [q, c] of perQuarter) {
    if (c !== 3) throw new DataError('mrt-od-incomplete-quarter', q, [`months read: ${c}`, 'expected 3']);
  }
  const filter = filterStations(monthly);
  const included = new Set(filter.included);
  return {
    main: sumByDistrict(monthly, (k) => included.has(k), stationDistrict, alias),
    all: sumByDistrict(monthly, () => true, stationDistrict, alias),
    filter,
  };
}
