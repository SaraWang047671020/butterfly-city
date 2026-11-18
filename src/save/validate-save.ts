// Validation of an untrusted, already JSON-parsed save (steps e to p of Requirement 13.5).
// Pure, never throws for any parsed JSON value. The first failure is returned.

import { CITY_NAMES } from '../types/data-files.ts';
import type { CityName, DistrictCode } from '../types/data-files.ts';
import { MAP_INDICATOR_IDS, MAX_TIMELINE_ENTRIES, SAVE_SCHEMA_VERSION } from '../types/save.ts';
import type { Save } from '../types/save.ts';
import type { RuleRegistry } from '../types/simulation.ts';

export type SaveValidationStep =
  | 'prefix'
  | 'length'
  | 'encoding'
  | 'json'
  | 'schema-version'
  | 'structure'
  | 'types'
  | 'quarters'
  | 'timeline-order'
  | 'registry'
  | 'districts'
  | 'map-indicator'
  | 'selected-district'
  | 'demo-flag'
  | 'seed'
  | 'finite';

export interface SaveCodeError {
  readonly step: SaveValidationStep;
  readonly path: string;
  readonly reason: string;
}

export interface SaveValidationContext {
  readonly registry: RuleRegistry;
  readonly districts: readonly { readonly code: DistrictCode; readonly city: CityName }[];
}

export const DIFFS_LENGTH = 44;
export const VERSION_MISMATCH_REASON = 'This save code was made by a different version of Butterfly City.';

type Json = unknown;
type Obj = Record<string, unknown>;

const SAVE_KEYS = [
  'demo', 'engineVersion', 'mapIndicator', 'next', 'policy', 'schemaVersion', 'seed', 'selectedDistrict', 'timeline',
];
const SERIES_KEYS = ['area', 'diffs', 'field', 'tool'];
const ENTRY_KEYS = ['after', 'area', 'before', 'field', 'kind', 'quarter', 'tool'];
const QUARTER_PATTERN = /^20(1[5-9]|2[0-5])Q[1-4]$/;

function fail(step: SaveValidationStep, path: string, reason: string): SaveCodeError {
  return { step, path, reason };
}

function isObj(value: Json): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysMatch(obj: Obj, expected: readonly string[]): string | null {
  const keys = Object.keys(obj).sort();
  for (const key of expected) if (!keys.includes(key)) return `missing key "${key}"`;
  for (const key of keys) if (!expected.includes(key)) return `unknown key "${key}"`;
  return null;
}

function quarterIndex(key: string): number {
  return (Number(key.slice(0, 4)) - 2015) * 4 + (Number(key[5]) - 1);
}

/** Returns the first error, or null when the value is a valid Save. */
export function validateSave(value: Json, ctx: SaveValidationContext): SaveCodeError | null {
  // e: schema-version
  if (!isObj(value)) return fail('structure', '$', 'the save must be an object');
  if (value['schemaVersion'] !== SAVE_SCHEMA_VERSION) {
    return fail('schema-version', 'schemaVersion', VERSION_MISMATCH_REASON);
  }

  // f: structure
  const rootProblem = keysMatch(value, SAVE_KEYS);
  if (rootProblem !== null) return fail('structure', '$', rootProblem);
  const policy = value['policy'];
  const timeline = value['timeline'];
  if (!Array.isArray(policy)) return fail('structure', 'policy', 'must be an array');
  if (!Array.isArray(timeline)) return fail('structure', 'timeline', 'must be an array');
  for (let i = 0; i < policy.length; i++) {
    const series: Json = policy[i];
    const path = `policy[${i}]`;
    if (!isObj(series)) return fail('structure', path, 'must be an object');
    const problem = keysMatch(series, SERIES_KEYS);
    if (problem !== null) return fail('structure', path, problem);
    const diffs = series['diffs'];
    if (!Array.isArray(diffs)) return fail('structure', `${path}.diffs`, 'must be an array');
    if (diffs.length !== DIFFS_LENGTH) {
      return fail('structure', `${path}.diffs`, `must have ${DIFFS_LENGTH} elements`);
    }
  }
  if (timeline.length > MAX_TIMELINE_ENTRIES) {
    return fail('structure', 'timeline', `the timeline has more than ${MAX_TIMELINE_ENTRIES} entries`);
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry: Json = timeline[i];
    const path = `timeline[${i}]`;
    if (!isObj(entry)) return fail('structure', path, 'must be an object');
    const problem = keysMatch(entry, ENTRY_KEYS);
    if (problem !== null) return fail('structure', path, problem);
  }

  // g: types
  if (typeof value['engineVersion'] !== 'string') return fail('types', 'engineVersion', 'must be a string');
  if (typeof value['next'] !== 'string') return fail('types', 'next', 'must be a string');
  if (typeof value['mapIndicator'] !== 'string') return fail('types', 'mapIndicator', 'must be a string');
  const selected = value['selectedDistrict'];
  if (selected !== null && typeof selected !== 'string') {
    return fail('types', 'selectedDistrict', 'must be a string or null');
  }
  if (typeof value['seed'] !== 'number') return fail('types', 'seed', 'must be a number');
  for (let i = 0; i < policy.length; i++) {
    const series = policy[i] as Obj;
    const path = `policy[${i}]`;
    if (typeof series['tool'] !== 'string') return fail('types', `${path}.tool`, 'must be a string');
    if (typeof series['field'] !== 'string') return fail('types', `${path}.field`, 'must be a string');
    if (typeof series['area'] !== 'string') return fail('types', `${path}.area`, 'must be a string');
    const diffs = series['diffs'] as Json[];
    for (let j = 0; j < diffs.length; j++) {
      if (typeof diffs[j] !== 'number') return fail('types', `${path}.diffs[${j}]`, 'must be a number');
    }
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i] as Obj;
    const path = `timeline[${i}]`;
    if (entry['kind'] !== 'value' && entry['kind'] !== 'real-track') {
      return fail('types', `${path}.kind`, 'must be "value" or "real-track"');
    }
    for (const key of ['quarter', 'tool', 'field', 'area']) {
      if (typeof entry[key] !== 'string') return fail('types', `${path}.${key}`, 'must be a string');
    }
    if (typeof entry['before'] !== 'number') return fail('types', `${path}.before`, 'must be a number');
    if (typeof entry['after'] !== 'number' && entry['after'] !== null) {
      return fail('types', `${path}.after`, 'must be a number or null');
    }
  }

  // h: quarters
  const next = value['next'] as string;
  if (next !== 'complete' && !QUARTER_PATTERN.test(next)) {
    return fail('quarters', 'next', 'must be a quarter from 2015Q1 to 2025Q4 or "complete"');
  }
  for (let i = 0; i < timeline.length; i++) {
    const quarter = (timeline[i] as Obj)['quarter'] as string;
    if (!QUARTER_PATTERN.test(quarter)) {
      return fail('quarters', `timeline[${i}].quarter`, 'must be a quarter from 2015Q1 to 2025Q4');
    }
  }

  // i: timeline-order
  if (next !== 'complete') {
    const limit = quarterIndex(next);
    for (let i = 0; i < timeline.length; i++) {
      const quarter = (timeline[i] as Obj)['quarter'] as string;
      if (quarterIndex(quarter) > limit) {
        return fail('timeline-order', `timeline[${i}].quarter`, `must not be after the next quarter ${next}`);
      }
    }
  }

  // j: registry
  const fieldOf = (tool: string, field: string) =>
    ctx.registry.tools.find((rule) => rule.id === tool)?.fields.find((f) => f.id === field);
  const seen = new Set<string>();
  for (let i = 0; i < policy.length; i++) {
    const series = policy[i] as Obj;
    const path = `policy[${i}]`;
    const tool = series['tool'] as string;
    const field = series['field'] as string;
    if (!ctx.registry.tools.some((rule) => rule.id === tool)) {
      return fail('registry', `${path}.tool`, `unknown tool "${tool}"`);
    }
    const spec = fieldOf(tool, field);
    if (spec === undefined) return fail('registry', `${path}.field`, `unknown field "${field}" for tool "${tool}"`);
    const id = JSON.stringify([tool, field, series['area']]);
    if (seen.has(id)) return fail('registry', path, 'duplicate series for the same tool, field and area');
    seen.add(id);
    if (spec.integer === true) {
      const diffs = series['diffs'] as number[];
      for (let j = 0; j < diffs.length; j++) {
        if (!Number.isInteger(diffs[j])) return fail('registry', `${path}.diffs[${j}]`, 'must be an integer');
      }
    }
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i] as Obj;
    const path = `timeline[${i}]`;
    const tool = entry['tool'] as string;
    const field = entry['field'] as string;
    if (!ctx.registry.tools.some((rule) => rule.id === tool)) {
      return fail('registry', `${path}.tool`, `unknown tool "${tool}"`);
    }
    const spec = fieldOf(tool, field);
    if (spec === undefined) return fail('registry', `${path}.field`, `unknown field "${field}" for tool "${tool}"`);
    if (spec.integer === true) {
      if (!Number.isInteger(entry['before'])) return fail('registry', `${path}.before`, 'must be an integer');
      if (entry['after'] !== null && !Number.isInteger(entry['after'])) {
        return fail('registry', `${path}.after`, 'must be an integer');
      }
    }
    if ((entry['kind'] === 'real-track') !== (entry['after'] === null)) {
      return fail('registry', `${path}.after`, 'must be null exactly for a real-track entry');
    }
  }

  // k: districts
  const codes = new Set(ctx.districts.map((d) => d.code));
  const areaOk = (tool: string, field: string, area: string): boolean => {
    const level = fieldOf(tool, field)?.area;
    if (level === 'district') return codes.has(area);
    return (CITY_NAMES as readonly string[]).includes(area);
  };
  for (let i = 0; i < policy.length; i++) {
    const series = policy[i] as Obj;
    if (!areaOk(series['tool'] as string, series['field'] as string, series['area'] as string)) {
      return fail('districts', `policy[${i}].area`, 'not a valid area for this field');
    }
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i] as Obj;
    if (!areaOk(entry['tool'] as string, entry['field'] as string, entry['area'] as string)) {
      return fail('districts', `timeline[${i}].area`, 'not a valid area for this field');
    }
  }

  // l: map-indicator
  if (!(MAP_INDICATOR_IDS as readonly string[]).includes(value['mapIndicator'] as string)) {
    return fail('map-indicator', 'mapIndicator', 'not a known map indicator');
  }

  // m: selected-district
  if (selected !== null && !codes.has(selected as string)) {
    return fail('selected-district', 'selectedDistrict', 'not a known district code');
  }

  // n: demo-flag
  if (typeof value['demo'] !== 'boolean') return fail('demo-flag', 'demo', 'must be true or false');

  // o: seed
  if (!Number.isInteger(value['seed'])) return fail('seed', 'seed', 'must be an integer');

  // p: finite
  if (!Number.isFinite(value['seed'])) return fail('finite', 'seed', 'must be a finite number');
  for (let i = 0; i < policy.length; i++) {
    const diffs = (policy[i] as Obj)['diffs'] as number[];
    for (let j = 0; j < diffs.length; j++) {
      if (!Number.isFinite(diffs[j])) return fail('finite', `policy[${i}].diffs[${j}]`, 'must be a finite number');
    }
  }
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i] as Obj;
    for (const key of ['before', 'after']) {
      const n = entry[key];
      if (n !== null && !Number.isFinite(n)) return fail('finite', `timeline[${i}].${key}`, 'must be a finite number');
    }
  }

  return null;
}

export function asSave(value: Json): Save {
  return value as Save;
}
