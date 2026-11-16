/**
 * Assembles the PolicyTrackFile (public/data/policy-track.json content) from the ten policy series.
 *
 * `buildPolicyTrackFile` is pure. It applies the fixed series order of POLICY_SERIES_SPECS, rounds each value to
 * the series' decimals, checks the record counts (41 districts x 44 quarters, 2 cities x 44 quarters) and embeds
 * the sources and methods the file references, in registry order (Requirement 12).
 */
import type {
  CityName,
  DistrictPolicySeries,
  CityPolicySeries,
  PolicySeries,
  PolicyTrackFile,
  TrackRecord,
} from '../../src/types/data-files.ts';
import { SCHEMA_VERSION } from '../../src/types/data-files.ts';
import type { Quarter } from '../lib/time.ts';
import { DISTRICTS } from '../lib/districts.ts';
import type { BuildContext } from './context.ts';
import { DataError } from './errors.ts';
import { roundTo } from './numeric.ts';
import type { PolicyTrackSeries } from './policy/track.ts';
import { CITIES } from './policy/track.ts';
import { POLICY_SERIES_SPECS } from './registry/indicators.ts';
import { methodById, referencedMethods } from './registry/methods.ts';
import { referencedSources, sourceById } from './registry/sources.ts';
import type { BuildState, IndicatorSummary, Step } from './run.ts';

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

function roundRecord(record: TrackRecord, decimals: number, where: string, problems: string[]): TrackRecord {
  if (typeof record.source !== 'string' || !knownSource(record.source)) {
    problems.push(`${where}: source ${String(record.source)} is not in the source registry`);
  }
  if (!Number.isFinite(record.value)) problems.push(`${where}: value is not a finite number`);
  const value = roundTo(record.value, decimals);
  if (record.estimated) {
    if (typeof record.method !== 'string' || !knownMethod(record.method)) {
      problems.push(`${where}: method ${String(record.method)} is not in the method registry`);
    }
    return { value, source: record.source, estimated: true, method: record.method };
  }
  return { value, source: record.source, estimated: false };
}

/** Builds the ordered series of one policy series spec; checks keys and record counts. */
function buildSeries(
  spec: (typeof POLICY_SERIES_SPECS)[number],
  raw: Readonly<Record<string, readonly TrackRecord[]>>,
  expectedKeys: readonly string[],
  quarters: readonly Quarter[],
  problems: string[],
): Record<string, TrackRecord[]> {
  const out: Record<string, TrackRecord[]> = {};
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

/** Assembles the policy track file. Throws one DataError listing every problem found. */
export function buildPolicyTrackFile(policyTrack: PolicyTrackSeries, quarters: readonly Quarter[]): PolicyTrackFile {
  const problems: string[] = [];
  const districtCodes = DISTRICTS.map((d) => d.code);
  const policySeries: PolicySeries[] = [];
  const sourceIds = new Set<string>();
  const methodIds = new Set<string>();

  for (const spec of POLICY_SERIES_SPECS) {
    const raw = (policyTrack as unknown as Record<string, Record<string, readonly TrackRecord[]> | undefined>)[spec.id];
    if (raw === undefined) {
      problems.push(`${spec.id}: series is missing`);
      continue;
    }
    const keys = spec.level === 'district' ? districtCodes : [...CITIES];
    const series = buildSeries(spec, raw, keys, quarters, problems);
    for (const s of spec.sources) {
      if (!knownSource(s)) problems.push(`${spec.id}: source ${s} is not in the source registry`);
      sourceIds.add(s);
    }
    for (const records of Object.values(series)) {
      for (const r of records) {
        sourceIds.add(r.source);
        if (r.estimated) methodIds.add(r.method);
      }
    }
    const base = {
      id: spec.id,
      tool: spec.tool,
      unit: spec.unit,
      kind: spec.kind,
      decimals: spec.decimals,
      description: spec.description,
      sources: [...spec.sources],
    };
    if (spec.level === 'district') {
      const entry: DistrictPolicySeries = { ...base, level: 'district', series };
      policySeries.push(entry);
    } else {
      const entry: CityPolicySeries = { ...base, level: 'city', series: series as Record<CityName, TrackRecord[]> };
      policySeries.push(entry);
    }
  }

  if (problems.length > 0) throw new DataError('policy-track', 'policy series', problems);

  return {
    schemaVersion: SCHEMA_VERSION,
    quarters: [...quarters],
    policySeries,
    sources: referencedSources(sourceIds),
    methods: referencedMethods(methodIds),
  };
}

/** Step factory: assembles state.policyTrack into state.policyTrackFile. Not part of DEFAULT_STEPS yet. */
export function policyFileStep(): Step {
  return {
    name: 'policy-file',
    run(ctx: BuildContext, state: BuildState) {
      if (state.policyTrack === undefined) {
        throw new DataError('missing-step-output', 'policy track', ['run the policy track step before the policy file step']);
      }
      const file = buildPolicyTrackFile(state.policyTrack, ctx.quarters);
      state.policyTrackFile = file;
      state.summaries.push(...summarizePolicyTrack(file));
    },
  };
}

/** One summary per policy series: number of records and number of estimated records. */
export function summarizePolicyTrack(file: PolicyTrackFile): IndicatorSummary[] {
  return file.policySeries.map((s) => {
    let values = 0;
    let estimated = 0;
    for (const records of Object.values(s.series as Record<string, readonly TrackRecord[]>)) {
      values += records.length;
      estimated += records.filter((r) => r.estimated).length;
    }
    return { id: s.id, values, estimated };
  });
}
