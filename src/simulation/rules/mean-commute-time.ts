// Mean commute time indicator rule (Requirements 2.1, 2.5, 12.1, 13.4).
// Start value: the Derived_Baseline T_d = sum over j of commute.jobShare.<j> x matrix[d][j].
// No tool changes commute time in this spec, so every tool Cause is the tool's delta, which is 0.

import type { DistrictCode } from '../../types/data-files.ts';
import type {
  CauseDraft,
  CauseLinks,
  Contribution,
  IndicatorRule,
  ParameterSpec,
  QuarterWork,
} from '../../types/simulation.ts';
import { derivedMeanCommuteTime } from '../derived.ts';
import { jobShareId } from '../params.ts';

const INDICATOR_ID = 'meanCommuteTime';
const NO_LINKS: CauseLinks = { parameterIds: [], sourceIds: [] };

function plain(x: number): number {
  return x === 0 ? 0 : x;
}

/** Sorted job-share ids per commute-code list; the list is fixed for a run, so it is built once. */
const JOB_SHARE_IDS = new WeakMap<readonly string[], readonly string[]>();

function jobShareIds(codes: readonly string[]): readonly string[] {
  let ids = JOB_SHARE_IDS.get(codes);
  if (ids === undefined) {
    ids = codes.map((code) => jobShareId(code)).sort();
    JOB_SHARE_IDS.set(codes, ids);
  }
  return ids;
}

function draft(d: DistrictCode, work: QuarterWork): CauseDraft {
  const { ctx } = work;
  const derived = derivedMeanCommuteTime(ctx.params, ctx.commute, d, work.quarter);
  // No error channel in a draft: NaN is reported by the stage-9 finite check.
  const start: Contribution = {
    value: derived.ok ? derived.value : Number.NaN,
    links: {
      parameterIds: jobShareIds(ctx.commute.codes),
      sourceIds: [],
    },
  };

  const tools = Object.entries(work.effects).map(([tool, effects]) => ({
    tool,
    value: plain(effects.deltas[INDICATOR_ID]?.[d] ?? 0),
    links: effects.links[INDICATOR_ID] ?? NO_LINKS,
  }));

  return {
    kind: 'non-negative',
    start,
    tools,
    events: [],
    migration: { value: 0, links: NO_LINKS },
  };
}

function parameters(): readonly ParameterSpec[] {
  // The per-district job shares are checked together with the commute matrix in stage 0.
  return [];
}

export const meanCommuteTimeRule: IndicatorRule = {
  id: INDICATOR_ID,
  unit: 'minutes',
  valueKind: 'non-negative',
  stage: 'pre-migration',
  parameters,
  draft,
};
