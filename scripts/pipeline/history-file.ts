/**
 * Assembles the HistoryFile (public/data/history.json content) from the twelve indicator series.
 *
 * `buildHistoryFile` is pure. It applies the fixed indicator order of INDICATOR_SPECS (10 district indicators,
 * then 2 city indicators), rounds every value once to the indicator's decimals, checks the record counts
 * (41 districts x 44 quarters, 2 cities x 44 quarters) and embeds the sources and methods the file references,
 * in registry order (Requirement 4, Decision D19).
 *
 * Rounding: the assembly is the place where values are rounded. Some builders (income, rent, sale price,
 * price-to-income) already round to the indicator's decimals; rounding a rounded value again returns the same
 * value, so the assembly is idempotent and safe for both kinds of builder.
 *
 * Embedded sources: every source named by an indicator's `sources`, plus the `inputs` of every method used by
 * the records, so the validator's source-reference check on method inputs passes.
 */
import type {
  CityIndicator,
  CityName,
  DistrictIndicator,
  HistoryFile,
  Indicator,
  ValueRecord,
} from '../../src/types/data-files.ts';
import { SCHEMA_VERSION } from '../../src/types/data-files.ts';
import type { CodeRef } from './indicators/series.ts';
import type { Quarter } from '../lib/time.ts';
import type { BuildContext } from './context.ts';
import { DataError } from './errors.ts';
import { roundTo } from './numeric.ts';
import { INDICATOR_SPECS, type IndicatorSpec } from './registry/indicators.ts';
import { methodById, referencedMethods } from './registry/methods.ts';
import { referencedSources, sourceById } from './registry/sources.ts';
import type { BuildState, IndicatorSummary, Step } from './run.ts';

const CITY_KEYS: readonly CityName[] = ['Taipei', 'New Taipei'];

/** The indicator series by indicator id (the BuildState fields have the same names). */
export type HistoryInput = Readonly<Record<string, Readonly<Record<string, readonly ValueRecord[]>> | undefined>>;

function knownSource(id: string): boolean {
  try {
    sourceById(id);
    return true;
  } catch {
    return false;
  }
}

function knownMethod(id: string): boolean {
  try {
    methodById(id);
    return true;
  } catch {
    return false;
  }
}

function roundRecord(record: ValueRecord, decimals: number, where: string, problems: string[]): ValueRecord {
  if (record.value !== null && !Number.isFinite(record.value)) {
    problems.push(`${where}: value is not a finite number`);
    return record;
  }
  const value = record.value === null ? null : roundTo(record.value, decimals);
  if (record.estimated) {
    if (typeof record.method !== 'string' || !knownMethod(record.method)) {
      problems.push(`${where}: method ${String(record.method)} is not in the method registry`);
    }
    return { value, estimated: true, method: record.method } as ValueRecord;
  }
  return { value: value as number, estimated: false };
}

function buildSeries(
  spec: IndicatorSpec,
  raw: Readonly<Record<string, readonly ValueRecord[]>>,
  expectedKeys: readonly string[],
  quarters: readonly Quarter[],
  problems: string[],
): Record<string, ValueRecord[]> {
  const out: Record<string, ValueRecord[]> = {};
  for (const key of expectedKeys) {
    const records = raw[key];
    if (records === undefined) {
      problems.push(`${spec.id}: missing series for ${key}`);
      continue;
    }
    if (records.length !== quarters.length) {
      problems.push(`${spec.id} ${key}: ${records.length} records, expected ${quarters.length}`);
      continue;
    }
    out[key] = records.map((r, i) => roundRecord(r, spec.decimals, `${spec.id} ${key} ${quarters[i]}`, problems));
  }
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(raw)) {
    if (!expected.has(key)) problems.push(`${spec.id}: unexpected series key ${key}`);
  }
  return out;
}

/** Assembles the history file. Throws one DataError listing every problem found. */
export function buildHistoryFile(
  input: HistoryInput,
  quarters: readonly Quarter[],
  districts: readonly CodeRef[],
): HistoryFile {
  const problems: string[] = [];
  const districtCodes = districts.map((d) => d.code);
  const indicators: Indicator[] = [];
  const sourceIds = new Set<string>();
  const methodIds = new Set<string>();

  for (const spec of INDICATOR_SPECS) {
    const raw = input[spec.id];
    if (raw === undefined) {
      problems.push(`${spec.id}: series is missing`);
      continue;
    }
    const keys = spec.level === 'district' ? districtCodes : CITY_KEYS;
    const series = buildSeries(spec, raw, keys, quarters, problems);
    for (const s of spec.sources) {
      if (!knownSource(s)) problems.push(`${spec.id}: source ${s} is not in the source registry`);
      sourceIds.add(s);
    }
    for (const records of Object.values(series)) {
      for (const r of records) if (r.estimated) methodIds.add(r.method);
    }
    const base = {
      id: spec.id,
      unit: spec.unit,
      kind: spec.kind,
      decimals: spec.decimals,
      description: spec.description,
      sources: [...spec.sources],
    };
    if (spec.level === 'district') {
      const entry: DistrictIndicator = { ...base, level: 'district', series };
      indicators.push(entry);
    } else {
      const entry: CityIndicator = { ...base, level: 'city', series: series as Record<CityName, ValueRecord[]> };
      indicators.push(entry);
    }
  }

  if (problems.length === 0) {
    for (const id of methodIds) {
      for (const s of methodById(id).inputs) sourceIds.add(s);
    }
  }
  if (problems.length > 0) throw new DataError('history', 'history indicators', problems);

  return {
    schemaVersion: SCHEMA_VERSION,
    quarters: [...quarters],
    indicators,
    sources: referencedSources(sourceIds),
    methods: referencedMethods(methodIds),
  };
}

/** Step factory: assembles the indicator series in state into state.historyFile. Not part of DEFAULT_STEPS yet. */
export function historyFileStep(): Step {
  return {
    name: 'history-file',
    run(ctx: BuildContext, state: BuildState) {
      const input: Record<string, Readonly<Record<string, readonly ValueRecord[]>> | undefined> = {};
      const missing: string[] = [];
      for (const spec of INDICATOR_SPECS) {
        const series = (state as unknown as Record<string, typeof input[string]>)[spec.id];
        if (series === undefined) missing.push(`${spec.id}: run its step before the history file step`);
        input[spec.id] = series;
      }
      if (missing.length > 0) throw new DataError('missing-step-output', 'history indicators', missing);
      const file = buildHistoryFile(input, ctx.quarters, ctx.districts);
      state.historyFile = file;
      state.summaries.push(...summarizeHistory(file));
    },
  };
}

/** One summary per indicator: number of records and number of estimated records. */
export function summarizeHistory(file: HistoryFile): IndicatorSummary[] {
  return file.indicators.map((ind) => {
    let values = 0;
    let estimated = 0;
    for (const records of Object.values(ind.series as Record<string, readonly ValueRecord[]>)) {
      values += records.length;
      estimated += records.filter((r) => r.estimated).length;
    }
    return { id: ind.id, values, estimated };
  });
}
