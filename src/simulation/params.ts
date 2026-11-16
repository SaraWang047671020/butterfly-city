// Parameter_Table access, ParameterSpec checks, metadata checks and Scenario tables.
// Pure functions. Rules read values only through scalar() and schedule(), after stage 0 validation.

import type {
  ParameterCheck,
  ParameterIssue,
  ParameterProblem,
  ParameterSpec,
  ParameterTable,
  ScalarParameter,
  ScenarioName,
  ScheduleParameter,
} from '../types/simulation.ts';
import { MAX_LAG, SHARE_SUM_TOLERANCE } from './constants.ts';

// ---------------------------------------------------------------------------
// Id expansion
// ---------------------------------------------------------------------------

export interface IdParts {
  readonly city?: string;
  readonly code?: string;
  readonly quarter?: string;
  readonly year?: number | string;
}

/** Replaces <city>, <code>, <quarter> and <year> in a parameter id template. Unknown parts stay as written. */
export function expandId(template: string, parts: IdParts): string {
  if (!template.includes('<')) return template;
  let out = '';
  let from = 0;
  for (;;) {
    const open = template.indexOf('<', from);
    if (open < 0) break;
    const close = template.indexOf('>', open);
    if (close < 0) break;
    const name = template.slice(open + 1, close);
    const known = name === 'city' || name === 'code' || name === 'quarter' || name === 'year';
    const part = known ? parts[name] : undefined;
    out += template.slice(from, open) + (part === undefined ? template.slice(open, close + 1) : String(part));
    from = close + 1;
  }
  return out + template.slice(from);
}

/** Id of the job-share parameter of a district; same result as expanding commute.jobShare.<code>. */
export function jobShareId(code: string): string {
  return 'commute.jobShare.' + code;
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

function entry(params: ParameterTable, id: string): ScalarParameter | ScheduleParameter | undefined {
  return Object.hasOwn(params, id) ? params[id] : undefined;
}

/**
 * Value of a scalar parameter. Call only after validation.
 * Returns NaN for an absent or non-scalar entry, so the stage-9 finite check reports it instead of a silent 0.
 */
export function scalar(params: ParameterTable, id: string): number {
  const p = entry(params, id);
  return p !== undefined && p.kind === 'scalar' ? p.value : Number.NaN;
}

/** Scalar value, or `undefined` when the optional parameter is absent. */
export function optionalScalar(params: ParameterTable, id: string): number | undefined {
  const p = entry(params, id);
  return p !== undefined && p.kind === 'scalar' ? p.value : undefined;
}

/** A schedule parameter, or `undefined` when absent or not a schedule. */
export function schedule(params: ParameterTable, id: string): ScheduleParameter | undefined {
  const p = entry(params, id);
  return p !== undefined && p.kind === 'schedule' ? p : undefined;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const STATUSES: readonly string[] = ['verified', 'check', 'secondary', 'gap'];
const LAG_PARAMETER_ID = 'socialHousing.lag';
const FIXED_DEFINITION_ID = 'ghost.rentThreshold';
const LAG_DERIVATION_TEXT = 'NLMA';

function blank(text: unknown): boolean {
  return typeof text !== 'string' || text.trim() === '';
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Value check of one scalar against its spec; returns the problems found. */
function checkScalarValue(p: ScalarParameter, check: ParameterCheck): ParameterProblem[] {
  const out: ParameterProblem[] = [];
  if (!isFiniteNumber(p.value)) {
    out.push('non-finite');
    return out;
  }
  const v = p.value;
  switch (check.kind) {
    case 'finite':
      break;
    case 'non-negative':
      if (v < 0) out.push('out-of-bounds');
      break;
    case 'positive':
      if (v <= 0) out.push('out-of-bounds');
      break;
    case 'share':
      if (v < 0 || v > 1) out.push('out-of-bounds');
      break;
    case 'unit-share':
      if (v <= 0 || v > 1) out.push('out-of-bounds');
      else if (p.range !== undefined && (p.range.low < 0 || p.range.high > 1)) {
        out.push('out-of-bounds');
      }
      break;
    case 'integer':
      if (!Number.isInteger(v) || v < check.min || v > check.max) out.push('out-of-bounds');
      break;
    case 'schedule':
      out.push('missing'); // a scalar where a schedule is required
      break;
  }
  return out;
}

function checkRange(p: ScalarParameter): ParameterProblem[] {
  const r = p.range;
  if (r === undefined) return [];
  const out: ParameterProblem[] = [];
  if (!isFiniteNumber(r.low) || !isFiniteNumber(r.high) || r.low > r.high) {
    out.push('range-invalid');
  } else if (isFiniteNumber(p.value) && (p.value < r.low || p.value > r.high)) {
    out.push('value-outside-range');
  }
  if (
    blank(r.lowSource?.citation) ||
    blank(r.lowSource?.url) ||
    blank(r.highSource?.citation) ||
    blank(r.highSource?.url)
  ) {
    out.push('source-empty');
  }
  return out;
}

function checkSchedule(p: ScheduleParameter): ParameterProblem[] {
  const { offsets, shares } = p;
  if (!Array.isArray(offsets) || !Array.isArray(shares)) return ['schedule-invalid'];
  if (offsets.length === 0 || offsets.length !== shares.length) return ['schedule-invalid'];
  const seen = new Set<number>();
  let sum = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const o = offsets[i];
    const s = shares[i];
    if (!isFiniteNumber(o) || !Number.isInteger(o) || o < 0 || o > MAX_LAG) return ['schedule-invalid'];
    if (!isFiniteNumber(s) || s < 0) return ['schedule-invalid'];
    if (seen.has(o)) return ['schedule-invalid'];
    seen.add(o);
    sum += s;
  }
  return Math.abs(sum - 1) > SHARE_SUM_TOLERANCE ? ['schedule-invalid'] : [];
}

/** Status, estimate, assumption and id-specific metadata checks (Requirements 14.10 to 14.12). */
function checkMetadata(id: string, p: ScalarParameter | ScheduleParameter): ParameterProblem[] {
  const out: ParameterProblem[] = [];
  const status: unknown = p.status;
  if (status === undefined || status === null) out.push('status-missing');
  else if (typeof status !== 'string' || !STATUSES.includes(status)) out.push('status-unknown');

  const needsEstimate = status === 'secondary' || status === 'gap';
  if (p.estimated === undefined) {
    if (needsEstimate) out.push('estimated-missing');
  } else if (blank(p.estimated.method)) {
    out.push('estimated-method-empty');
  }

  if (status === 'gap' && blank(p.assumption)) out.push('assumption-missing');

  if (id === LAG_PARAMETER_ID) {
    const method = p.estimated?.method;
    if (typeof method !== 'string' || !method.includes(LAG_DERIVATION_TEXT)) {
      out.push('lag-derivation-missing');
    }
  }
  if (id === FIXED_DEFINITION_ID && p.kind === 'scalar' && p.range !== undefined) {
    out.push('range-not-allowed');
  }
  return out;
}

/** All problems of one spec, without duplicates. */
function checkSpec(params: ParameterTable, spec: ParameterSpec): ParameterProblem[] {
  const p = entry(params, spec.id);
  if (p === undefined) return spec.optional === true ? [] : ['missing'];

  const out: ParameterProblem[] = [];
  if (spec.check.kind === 'schedule') {
    if (p.kind !== 'schedule') return ['missing'];
  } else if (p.kind !== 'scalar') {
    return ['missing'];
  }

  if (blank(p.unit)) out.push('unit-empty');
  if (blank(p.source?.citation) || blank(p.source?.url)) out.push('source-empty');

  if (p.kind === 'scalar') {
    out.push(...checkScalarValue(p, spec.check));
    out.push(...checkRange(p));
  } else {
    out.push(...checkSchedule(p));
  }
  out.push(...checkMetadata(spec.id, p));
  return [...new Set(out)];
}

/** Checks every spec against the table and returns all issues (unsorted; errors.ts sorts them). */
export function checkSpecs(
  params: ParameterTable,
  specs: readonly ParameterSpec[],
): readonly ParameterIssue[] {
  const issues: ParameterIssue[] = [];
  const done = new Set<string>();
  for (const spec of specs) {
    for (const problem of checkSpec(params, spec)) {
      const key = `${spec.id}\u0000${problem}`;
      if (done.has(key)) continue;
      done.add(key);
      issues.push({ parameterId: spec.id, problem });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Scenario tables
// ---------------------------------------------------------------------------

/**
 * The ranged effect parameters that vary between Scenarios (design, "Parameters").
 * Every other parameter, ranged or not, keeps its `value`.
 */
export const SCENARIO_EFFECT_IDS: readonly string[] = [
  'socialHousing.rentPerUnit',
  'socialHousing.rentRatio',
  'commuterPass.elasticity',
  'rentSubsidy.passThrough',
  'ghost.commuteThreshold',
  'ghost.shareCommuteWithin',
];

/**
 * A new table for one Scenario. Only the listed effect parameters that have a `range`
 * take `range.low` or `range.high`. The input table is never changed.
 */
export function scenarioTable(
  params: ParameterTable,
  scenario: ScenarioName,
  effectIds: readonly string[] = SCENARIO_EFFECT_IDS,
): ParameterTable {
  const out: Record<string, ScalarParameter | ScheduleParameter> = {};
  for (const id of Object.keys(params)) {
    const p = params[id];
    if (p === undefined) continue;
    if (
      scenario !== 'central' &&
      effectIds.includes(id) &&
      p.kind === 'scalar' &&
      p.range !== undefined
    ) {
      out[id] = { ...p, value: scenario === 'low' ? p.range.low : p.range.high };
    } else {
      out[id] = p;
    }
  }
  return out;
}
