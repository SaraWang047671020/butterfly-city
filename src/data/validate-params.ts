// Parameter_Entry checker (data-pipeline Requirements 20.3, 20.8, 20.9, 25.4).
// Pure: no I/O, no DOM. The Params_File validator (task 26) and the commute config reader reuse it.

import { SCHEMA_VERSION } from '../types/data-files.ts';
import type { ParameterIssue, ParameterProblem, ParameterTable } from '../types/simulation.ts';
import { checkSpecs, expandId } from '../simulation/params.ts';
import { RULE_REGISTRY, collectParameterSpecs } from '../simulation/registry.ts';
import { SHARE_SUM_TOLERANCE } from '../simulation/constants.ts';
import type { ValidationContext, ValidationError } from './validate.ts';

export interface CheckParameterEntryOptions {
  /**
   * When true, a `gap` entry may leave `source.citation` and `source.url` empty (Commute_Config_File,
   * Requirement 25.3). Range sources are still checked. Default false.
   */
  readonly sourceOptionalForGap?: boolean;
}

const STATUSES: readonly string[] = ['verified', 'check', 'secondary', 'gap'];

function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonBlank(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function citationOk(x: unknown): boolean {
  return isRecord(x) && isNonBlank(x.citation) && isNonBlank(x.url);
}

/**
 * Checks one Parameter_Entry (scalar or schedule). Returns one issue per failed check, sorted by
 * problem. An empty array means the entry passes.
 */
export function checkParameterEntry(
  id: string,
  entry: unknown,
  options: CheckParameterEntryOptions = {},
): readonly ParameterIssue[] {
  const problems = new Set<ParameterProblem>();
  const issues = (): readonly ParameterIssue[] =>
    [...problems].sort().map((problem) => ({ parameterId: id, problem }));

  if (!isRecord(entry) || (entry.kind !== 'scalar' && entry.kind !== 'schedule')) {
    problems.add('missing');
    return issues();
  }

  if (entry.kind === 'scalar') {
    if (!isFiniteNumber(entry.value)) problems.add('non-finite');
  } else {
    const { offsets, shares } = entry;
    const ok =
      Array.isArray(offsets) &&
      Array.isArray(shares) &&
      offsets.length > 0 &&
      offsets.length === shares.length &&
      offsets.every(isFiniteNumber) &&
      shares.every(isFiniteNumber);
    if (!ok) problems.add('schedule-invalid');
  }

  if (!isNonBlank(entry.unit)) problems.add('unit-empty');

  const status = entry.status;
  if (status === undefined || status === null) problems.add('status-missing');
  else if (typeof status !== 'string' || !STATUSES.includes(status)) problems.add('status-unknown');

  if (!citationOk(entry.source) && !(options.sourceOptionalForGap === true && status === 'gap')) {
    problems.add('source-empty');
  }

  if (status === 'secondary' || status === 'gap') {
    if (!isRecord(entry.estimated)) problems.add('estimated-missing');
    else if (!isNonBlank(entry.estimated.method)) problems.add('estimated-method-empty');
  }
  if (status === 'gap' && !isNonBlank(entry.assumption)) problems.add('assumption-missing');

  if (entry.range !== undefined) {
    const range = entry.range;
    if (!isRecord(range) || !isFiniteNumber(range.low) || !isFiniteNumber(range.high) || range.low > range.high) {
      problems.add('range-invalid');
    } else {
      if (entry.kind === 'scalar' && isFiniteNumber(entry.value) && (entry.value < range.low || entry.value > range.high)) {
        problems.add('value-outside-range');
      }
      if (!citationOk(range.lowSource) || !citationOk(range.highSource)) problems.add('source-empty');
    }
    if (entry.kind === 'schedule') problems.add('range-not-allowed');
  }

  return issues();
}

// ---------------------------------------------------------------------------------------------
// Params_File validator (Requirements 20.1 to 20.3, 20.8, 20.9, 23.8, 27.11)
// ---------------------------------------------------------------------------------------------
// Reuses the engine's pure stage 0 functions (`checkSpecs`, `collectParameterSpecs`); no copy, so no
// parity test is needed (Decision D33). `src/data` may import `src/simulation`; the reverse is forbidden.

/** Expected number of ids per Parameter_Source_Type (Requirement 20, 52 + 76 + 12 = 140; housing-tools removed the 7 factor limits and added 44 type 1 and 22 type 2 Documented_Limits). */
export const EXPECTED_SOURCE_TYPE_COUNTS: Readonly<Record<1 | 2 | 3, number>> = { 1: 54, 2: 76, 3: 14 };

const GHOST_SIZE_ID = 'ghost.size';
const SHARE_BOTH_ID = 'ghost.shareBoth';
const SHARE_RENT_ID = 'ghost.shareRent';
const WITHIN_ID = 'ghost.shareCommuteWithin';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const keyAt = (k: string): string => `$.parameters[${JSON.stringify(k)}]`;

function ruleOf(problem: ParameterProblem): string {
  switch (problem) {
    case 'out-of-bounds':
      return 'check-kind';
    case 'schedule-invalid':
      return 'schedule';
    case 'assumption-missing':
      return 'gap';
    case 'lag-derivation-missing':
    case 'range-not-allowed':
    case 'group-invalid':
    case 'limit-invalid':
      return 'special';
    default:
      return 'entry';
  }
}

/** Validates the wrapped params.json form. Never throws; collects every error with its JSON path. */
export function validateParamsFile(x: unknown, ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  const add = (path: string, rule: string, message: string): void => {
    const key = `${path}\u0000${rule}\u0000${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ file: 'params.json', path, rule, message });
  };

  if (!isRecord(x)) {
    add('$', 'type', 'params.json must be an object');
    return errors;
  }
  if (x.schemaVersion !== SCHEMA_VERSION) add('$.schemaVersion', 'type', `schemaVersion must be ${SCHEMA_VERSION}`);
  for (const k of Object.keys(x)) {
    if (k !== 'schemaVersion' && k !== 'parameters') add(`$.${k}`, 'type', `unexpected top-level key "${k}"`);
  }
  const params = x.parameters;
  if (params === undefined) {
    add('$.parameters', 'required', 'field "parameters" is required');
    return errors;
  }
  if (!isRecord(params)) {
    add('$.parameters', 'type', '"parameters" must be an object');
    return errors;
  }

  const ids = Object.keys(params);
  for (let i = 1; i < ids.length; i += 1) {
    if ((ids[i - 1] as string) >= (ids[i] as string)) {
      add(keyAt(ids[i] as string), 'order', `id "${ids[i]}" is not in ascending code-point order after "${ids[i - 1]}"`);
    }
  }

  // Id set (Requirement 20.4 on the validator side)
  // Skipped when `engineIdSet` or `sourceTypes` is absent (the web app loader does not have them).
  const engineIds = ctx.engineIdSet ?? [];
  const sourceTypes = ctx.sourceTypes ?? {};
  if (ctx.engineIdSet !== undefined) {
    const expected = new Set(engineIds);
    for (const id of engineIds) {
      if (!has(params, id)) add(keyAt(id), 'id-set', `id "${id}" is required by the engine and missing`);
    }
    for (const id of ids) {
      if (!expected.has(id)) add(keyAt(id), 'id-set', `id "${id}" is not read by the engine`);
    }
  }

  // Entry shape and the engine's per-id checks
  const wellFormed = new Set<string>();
  for (const id of ids) {
    const entry = params[id];
    if (!isRecord(entry)) {
      add(keyAt(id), 'type', 'a parameter entry must be an object');
      continue;
    }
    wellFormed.add(id);
    for (const issue of checkParameterEntry(id, entry)) {
      add(keyAt(id), ruleOf(issue.problem), `${id}: ${issue.problem}`);
    }
  }
  const specs = [
    ...collectParameterSpecs(RULE_REGISTRY),
    ...ctx.districtCodes.map((code) => ({
      id: expandId('commute.jobShare.<code>', { code }),
      role: 'derivation' as const,
      check: { kind: 'share' as const },
    })),
  ].filter((s) => wellFormed.has(s.id));
  for (const issue of checkSpecs(params as unknown as ParameterTable, specs)) {
    add(keyAt(issue.parameterId), ruleOf(issue.problem), `${issue.parameterId}: ${issue.problem}`);
  }

  // Group checks the engine runs after the specs
  const num = (id: string): number | undefined => {
    const e = params[id];
    return isRecord(e) && e.kind === 'scalar' && isFiniteNumber(e.value) ? e.value : undefined;
  };
  const size = num(GHOST_SIZE_ID);
  if (size !== undefined && (!Number.isInteger(size) || size < 1)) {
    add(keyAt(GHOST_SIZE_ID), 'check-kind', `${GHOST_SIZE_ID}: must be an integer of at least 1`);
  }
  const both = num(SHARE_BOTH_ID);
  const rent = num(SHARE_RENT_ID);
  const within = params[WITHIN_ID];
  if (both !== undefined && rent !== undefined && isRecord(within) && within.kind === 'scalar') {
    const range = within.range;
    const high = isRecord(range) && isFiniteNumber(range.high) ? range.high : within.value;
    if (isFiniteNumber(high) && both > Math.min(rent, 1 - high)) {
      add(keyAt(SHARE_BOTH_ID), 'special', `${SHARE_BOTH_ID} exceeds min(shareRent, 1 - shareCommuteWithin.high)`);
    }
  }
  let jobSum = 0;
  let jobComplete = true;
  for (const code of ctx.districtCodes) {
    const v = num(expandId('commute.jobShare.<code>', { code }));
    if (v === undefined) jobComplete = false;
    else jobSum += v;
  }
  if (jobComplete && Math.abs(jobSum - 1) > SHARE_SUM_TOLERANCE) {
    add('$.parameters', 'special', `commute.jobShare.* sum to ${jobSum}, expected 1 within ${SHARE_SUM_TOLERANCE}`);
  }

  // Parameter_Source_Type counts (Requirement 27.11) and the gap link (Requirement 23.8)
  const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const id of ctx.sourceTypes === undefined ? [] : ids) {
    const t = sourceTypes[id];
    if (t !== 1 && t !== 2 && t !== 3) {
      add(keyAt(id), 'source-type', `id "${id}" has no Parameter_Source_Type of 1, 2 or 3`);
      continue;
    }
    counts[t] += 1;
    const entry = params[id];
    const gap = isRecord(entry) && entry.status === 'gap';
    if (t === 3 && !gap) add(keyAt(id), 'source-type', `type 3 id "${id}" must have status gap`);
  }
  for (const t of ctx.sourceTypes === undefined ? [] : ([1, 2, 3] as const)) {
    if (counts[t] !== EXPECTED_SOURCE_TYPE_COUNTS[t]) {
      add('$.parameters', 'source-type', `Parameter_Source_Type ${t}: ${counts[t]} ids, expected ${EXPECTED_SOURCE_TYPE_COUNTS[t]}`);
    }
  }
  return errors;
}
