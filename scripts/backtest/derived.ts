/**
 * Backtest_Derived_File `data/derived/backtest-mrt-quarterly.json` (data-pipeline Requirements 27.24 to 27.28).
 *
 * The file holds what the TPASS backtest needs from the 24 monthly Taipei Metro station files, so the staleness
 * test and a checkout without `data/raw/` can regenerate `docs/BACKTEST.md` without reading raw data. Pure
 * functions build, check, compare and serialize it; the small IO helpers read and write the committed file.
 * Not imported by `src/` or by the data build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.ts';
import { DataError } from '../pipeline/errors.ts';
import { serializeJson } from '../pipeline/serialize.ts';
import type { EngineBaseline } from '../../src/types/simulation.ts';
import type { BacktestCase } from './cases.ts';
import { computeObserved, type MrtDerivedInput, type PeriodSums } from './compute.ts';
import {
  BACKTEST_MONTHS,
  quarterlyByDistrict,
  type MonthlyEntries,
  type QuarterlyResult,
} from './mrt-monthly.ts';

export const DERIVED_FILE = path.join(ROOT, 'data', 'derived', 'backtest-mrt-quarterly.json');
export const DERIVED_SCHEMA_VERSION = 1;

export interface DerivedMonth {
  readonly month: string;
  /** The `source` URL of the monthly file. */
  readonly source: string;
  /** Stations with entries greater than 0 in the month. */
  readonly stationCount: number;
}

export interface DerivedExcluded {
  readonly station: string;
  readonly reason: string;
}

export interface DerivedObserved {
  readonly main: PeriodSums;
  readonly all: PeriodSums;
}

/** District code -> quarter -> entries. */
export type QuarterlyObject = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface DerivedBacktest {
  readonly schemaVersion: number;
  readonly months: readonly DerivedMonth[];
  /** Codes of the districts that have a Taipei Metro station. */
  readonly stationDistrictCodes: readonly string[];
  /** Station keys of the main result (entries in all 24 months). */
  readonly mainStations: readonly string[];
  readonly excludedStations: readonly DerivedExcluded[];
  readonly excludedShare2023: number | null;
  readonly quarterly: { readonly main: QuarterlyObject; readonly all: QuarterlyObject };
  /** Observed effect per case id, computed from the sums above. */
  readonly observed: Readonly<Record<string, DerivedObserved>>;
}

function toObject(m: ReadonlyMap<string, ReadonlyMap<string, number>>): QuarterlyObject {
  const out: Record<string, Record<string, number>> = {};
  for (const d of [...m.keys()].sort()) {
    const byQ = m.get(d) ?? new Map<string, number>();
    const row: Record<string, number> = {};
    for (const q of [...byQ.keys()].sort()) row[q] = byQ.get(q) ?? 0;
    out[d] = row;
  }
  return out;
}

function toMap(o: QuarterlyObject): Map<string, Map<string, number>> {
  return new Map(Object.entries(o).map(([d, row]) => [d, new Map(Object.entries(row))]));
}

/** The compute input that reads the derived sums instead of the monthly files. */
export function mrtInputFromDerived(d: DerivedBacktest): MrtDerivedInput {
  const quarterly: QuarterlyResult = {
    main: toMap(d.quarterly.main),
    all: toMap(d.quarterly.all),
    filter: { included: d.mainStations, excluded: d.excludedStations.map((s) => s.station), excludedShare2023: d.excludedShare2023 },
  };
  return { quarterly, stationDistrictCodes: d.stationDistrictCodes };
}

/** Builds the derived content from the monthly files (needs `source` on every month). */
export function buildDerived(
  monthly: readonly MonthlyEntries[],
  stationDistrict: ReadonlyMap<string, string>,
  cases: readonly BacktestCase[],
  baseline: EngineBaseline,
): DerivedBacktest {
  const q = quarterlyByDistrict(monthly, stationDistrict);
  const months: DerivedMonth[] = monthly.map((m) => {
    if (m.source === undefined) throw new DataError('backtest-derived', m.month, ['monthly file has no source']);
    return { month: m.month, source: m.source, stationCount: [...m.entries.values()].filter((n) => n > 0).length };
  });
  const excludedStations: DerivedExcluded[] = q.filter.excluded.map((station) => ({
    station,
    reason: `no entries in ${monthly.filter((m) => !((m.entries.get(station) ?? 0) > 0)).map((m) => m.month).join(', ')}`,
  }));
  const base: DerivedBacktest = {
    schemaVersion: DERIVED_SCHEMA_VERSION,
    months,
    stationDistrictCodes: [...new Set(stationDistrict.values())].sort(),
    mainStations: [...q.filter.included],
    excludedStations,
    excludedShare2023: q.filter.excludedShare2023,
    quarterly: { main: toObject(q.main), all: toObject(q.all) },
    observed: {},
  };
  const input = mrtInputFromDerived(base);
  const observed: Record<string, DerivedObserved> = {};
  for (const c of cases) {
    const r = computeObserved(c, baseline, input);
    if (!r.ok) throw new DataError('backtest-derived', c.id, [r.reason]);
    const { postChangeYear, postComparisonYear, preChangeYear, preComparisonYear, effect } = r.value;
    observed[c.id] = {
      main: { postChangeYear, postComparisonYear, preChangeYear, preComparisonYear, effect },
      all: r.value.allStations,
    };
  }
  return { ...base, observed };
}

/** Canonical text of the file (pipeline serializer). */
export function serializeDerived(d: DerivedBacktest): string {
  return serializeJson(d);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bad(file: string, where: string, expected: string): never {
  throw new DataError('backtest-derived-schema', file, [`field: ${where}`, `expected ${expected}`]);
}

function num(file: string, where: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(file, where, 'a finite number');
  return v as number;
}

function str(file: string, where: string, v: unknown): string {
  if (typeof v !== 'string' || v === '') bad(file, where, 'a non-empty string');
  return v as string;
}

function strList(file: string, where: string, v: unknown): string[] {
  if (!Array.isArray(v)) return bad(file, where, 'a list');
  return v.map((x, i) => str(file, `${where}[${i}]`, x));
}

function quarterlyOf(file: string, where: string, v: unknown): QuarterlyObject {
  if (!isObj(v)) return bad(file, where, 'an object of districts');
  const out: Record<string, Record<string, number>> = {};
  for (const [d, row] of Object.entries(v)) {
    if (!isObj(row)) return bad(file, `${where}.${d}`, 'an object of quarters');
    const r: Record<string, number> = {};
    for (const [q, n] of Object.entries(row)) {
      if (!/^\d{4}Q[1-4]$/.test(q)) bad(file, `${where}.${d}.${q}`, 'a quarter key such as 2023Q1');
      const value = num(file, `${where}.${d}.${q}`, n);
      if (value < 0) bad(file, `${where}.${d}.${q}`, 'a non-negative number');
      r[q] = value;
    }
    out[d] = r;
  }
  return out;
}

function periodOf(file: string, where: string, v: unknown): PeriodSums {
  if (!isObj(v)) return bad(file, where, 'an object');
  return {
    postChangeYear: num(file, `${where}.postChangeYear`, v['postChangeYear']),
    postComparisonYear: num(file, `${where}.postComparisonYear`, v['postComparisonYear']),
    preChangeYear: num(file, `${where}.preChangeYear`, v['preChangeYear']),
    preComparisonYear: num(file, `${where}.preComparisonYear`, v['preComparisonYear']),
    effect: num(file, `${where}.effect`, v['effect']),
  };
}

/** Parses and checks the file text. Stops with a DataError naming the file and the field. */
export function parseDerived(text: string, file: string): DerivedBacktest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DataError('backtest-derived-schema', file, [`not valid JSON: ${(e as Error).message}`]);
  }
  if (!isObj(raw)) return bad(file, '(root)', 'an object');
  if (raw['schemaVersion'] !== DERIVED_SCHEMA_VERSION) bad(file, 'schemaVersion', String(DERIVED_SCHEMA_VERSION));
  if (!Array.isArray(raw['months'])) return bad(file, 'months', 'a list');
  const months: DerivedMonth[] = raw['months'].map((m: unknown, i: number) => {
    if (!isObj(m)) return bad(file, `months[${i}]`, 'an object');
    const count = num(file, `months[${i}].stationCount`, m['stationCount']);
    if (!Number.isInteger(count) || count < 0) bad(file, `months[${i}].stationCount`, 'a non-negative integer');
    return { month: str(file, `months[${i}].month`, m['month']), source: str(file, `months[${i}].source`, m['source']), stationCount: count };
  });
  if (months.length !== BACKTEST_MONTHS.length || months.some((m, i) => m.month !== BACKTEST_MONTHS[i])) {
    bad(file, 'months', `the ${BACKTEST_MONTHS.length} months ${BACKTEST_MONTHS[0]}..${BACKTEST_MONTHS[BACKTEST_MONTHS.length - 1]} in order`);
  }
  if (!Array.isArray(raw['excludedStations'])) return bad(file, 'excludedStations', 'a list');
  const excludedStations: DerivedExcluded[] = raw['excludedStations'].map((s: unknown, i: number) => {
    if (!isObj(s)) return bad(file, `excludedStations[${i}]`, 'an object');
    return { station: str(file, `excludedStations[${i}].station`, s['station']), reason: str(file, `excludedStations[${i}].reason`, s['reason']) };
  });
  const share = raw['excludedShare2023'];
  if (share !== null && (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1)) {
    bad(file, 'excludedShare2023', 'null or a number from 0 to 1');
  }
  const quarterly = raw['quarterly'];
  if (!isObj(quarterly)) return bad(file, 'quarterly', 'an object');
  const observedRaw = raw['observed'];
  if (!isObj(observedRaw)) return bad(file, 'observed', 'an object');
  const observed: Record<string, DerivedObserved> = {};
  for (const [id, v] of Object.entries(observedRaw)) {
    if (!isObj(v)) return bad(file, `observed.${id}`, 'an object');
    observed[id] = { main: periodOf(file, `observed.${id}.main`, v['main']), all: periodOf(file, `observed.${id}.all`, v['all']) };
  }
  return {
    schemaVersion: DERIVED_SCHEMA_VERSION,
    months,
    stationDistrictCodes: strList(file, 'stationDistrictCodes', raw['stationDistrictCodes']),
    mainStations: strList(file, 'mainStations', raw['mainStations']),
    excludedStations,
    excludedShare2023: share as number | null,
    quarterly: { main: quarterlyOf(file, 'quarterly.main', quarterly['main']), all: quarterlyOf(file, 'quarterly.all', quarterly['all']) },
    observed,
  };
}

export interface DerivedDifference {
  readonly path: string;
  readonly committed: string;
  readonly recomputed: string;
}

function show(v: unknown): string {
  return v === undefined ? '(absent)' : JSON.stringify(v);
}

function walk(a: unknown, b: unknown, at: string, out: DerivedDifference[]): void {
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[k], b[k], at === '' ? k : `${at}.${k}`, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${at}[${i}]`, out);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: at, committed: show(a), recomputed: show(b) });
}

/** Every path where the committed content and the recomputed content differ. Empty when they are equal. */
export function diffDerived(committed: DerivedBacktest, recomputed: DerivedBacktest): DerivedDifference[] {
  const out: DerivedDifference[] = [];
  walk(JSON.parse(serializeDerived(committed)), JSON.parse(serializeDerived(recomputed)), '', out);
  return out;
}

export type DerivedDecision =
  /** Raw files present, file absent: write `derived`. */
  | { readonly kind: 'create'; readonly derived: DerivedBacktest }
  /** Both present and equal: use the committed file. */
  | { readonly kind: 'verified'; readonly derived: DerivedBacktest }
  /** Raw files absent, file present: use the committed file. */
  | { readonly kind: 'derived-only'; readonly derived: DerivedBacktest }
  /** Both present and different: stop; nothing is overwritten. */
  | { readonly kind: 'differs'; readonly differences: readonly DerivedDifference[] }
  /** Neither present: stop with the download commands. */
  | { readonly kind: 'missing' };

/**
 * The four modes of Requirements 27.26 and 27.27. `recompute` is called only when all 24 raw files exist.
 * Nothing is written here.
 */
export function resolveDerived(rawComplete: boolean, committed: DerivedBacktest | null, recompute: () => DerivedBacktest): DerivedDecision {
  if (!rawComplete) return committed === null ? { kind: 'missing' } : { kind: 'derived-only', derived: committed };
  const fresh = recompute();
  if (committed === null) return { kind: 'create', derived: fresh };
  const differences = diffDerived(committed, fresh);
  return differences.length > 0 ? { kind: 'differs', differences } : { kind: 'verified', derived: committed };
}

/** Reads the committed file. Null when it does not exist. */
export function readDerivedFile(file: string = DERIVED_FILE): DerivedBacktest | null {
  if (!existsSync(file)) return null;
  return parseDerived(readFileSync(file, 'utf8'), path.relative(ROOT, file).replace(/\\/g, '/'));
}

/** Writes the file; used only when it does not exist yet. */
export function writeDerivedFile(d: DerivedBacktest, file: string = DERIVED_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeDerived(d), 'utf8');
}
