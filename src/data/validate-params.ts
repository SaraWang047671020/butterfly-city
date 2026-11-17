// Parameter_Entry checker (data-pipeline Requirements 20.3, 20.8, 20.9, 25.4).
// Pure: no I/O, no DOM. The Params_File validator (task 26) and the commute config reader reuse it.

import type { ParameterIssue, ParameterProblem } from '../types/simulation.ts';

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
