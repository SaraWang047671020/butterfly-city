/**
 * `migration.commuteCostPerMinute` for the parameter table (Requirements 20.10, 20.11, 29.6).
 *
 * The entry is built once by the fare slope step (`commuteCostEntry`, task 23) and kept in
 * `BuildState.fareSlope`. This module re-checks it and returns it with its Method text; it does not
 * recompute the slope.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { COMMUTE_COST_ID } from '../commute/fares.ts';
import type { FareSlopeResult } from '../commute/step.ts';
import { DataError } from '../errors.ts';
import type { ParamMethodNote } from './job-share.ts';

export interface CommuteCostParam {
  readonly id: string;
  readonly entry: ScalarParameter;
  readonly methods: readonly ParamMethodNote[];
}

export function commuteCostParam(fareSlope: FareSlopeResult | undefined): CommuteCostParam {
  if (fareSlope === undefined) {
    throw new DataError('missing-step-output', 'fare slope', ['run the fare slope step before the parameter table']);
  }
  const entry = fareSlope.entry;
  const issues = checkParameterEntry(COMMUTE_COST_ID, entry);
  if (issues.length > 0) throw new DataError('commute-cost-entry-invalid', COMMUTE_COST_ID, issues.map((i) => i.problem));
  const method = entry.estimated?.method ?? '';
  return { id: COMMUTE_COST_ID, entry, methods: [{ ids: [COMMUTE_COST_ID], method }] };
}
