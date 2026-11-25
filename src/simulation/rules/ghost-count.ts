// Ghost count indicator rule (Requirement 10). Stage post-migration.
// Collects the ghostGroups of every registry tool from the quarter's effects and passes them to
// ghosts.ts, which builds the Baseline and the seven group Causes. The running Scenario's parameter
// table gives the Derived_Baseline count (Requirement 19.8).

import type { DistrictCode } from '../../types/data-files.ts';
import type {
  CauseDraft,
  GhostGroupContribution,
  IndicatorRule,
  ParameterSpec,
  QuarterWork,
} from '../../types/simulation.ts';
import { derivedMeanCommuteTime } from '../derived.ts';
import { ghostDraft } from '../ghosts.ts';

const INDICATOR_ID = 'ghostCount';

function specs(): readonly ParameterSpec[] {
  return [
    { id: 'ghost.size', role: 'ghost-size', check: { kind: 'positive' } },
    { id: 'ghost.shareRent', role: 'derivation', check: { kind: 'share' } },
    { id: 'ghost.shareCommuteWithin', role: 'derivation', check: { kind: 'share' } },
    { id: 'ghost.shareBoth', role: 'derivation', check: { kind: 'share' } },
    { id: 'ghost.sensitivityRent', role: 'effect', check: { kind: 'share' } },
    { id: 'ghost.sensitivityCommute', role: 'effect', check: { kind: 'non-negative' } },
    { id: 'ghost.commuteThreshold', role: 'reference', check: { kind: 'positive' } },
    // Cited definition only; never used in a formula.
    { id: 'ghost.rentThreshold', role: 'reference', check: { kind: 'positive' } },
  ];
}

function baselineValue(work: QuarterWork, indicator: string, d: DistrictCode): number {
  const v = work.ctx.baseline.indicators[indicator]?.[d]?.[work.quarterIndex];
  return typeof v === 'number' ? v : Number.NaN;
}

/** Ghost inputs of one district; shared by `draft` and `ghostCountValue`. */
function build(d: DistrictCode, work: QuarterWork): { readonly count: number; readonly draft: CauseDraft } {
  const { params, baseline, commute } = work.ctx;

  const groups: GhostGroupContribution[] = [];
  for (const tool of Object.keys(work.effects)) {
    const list = work.effects[tool]?.ghostGroups?.[d];
    if (list !== undefined) groups.push(...list);
  }

  const baselineP = baselineValue(work, 'population', d);
  const t0 = derivedMeanCommuteTime(params, commute, d, baseline.quarters[work.quarterIndex] ?? work.quarter);
  const baselineT = t0.ok ? t0.value : Number.NaN;

  const population = work.values.population?.[d] ?? baselineP;
  const commuteTime = work.values.meanCommuteTime?.[d] ?? baselineT;
  const displaced = work.migration?.displaced[d] ?? 0;

  return ghostDraft(params, {
    population,
    commuteTime,
    displaced,
    groups,
    baselinePopulation: baselineP,
    baselineCommuteTime: baselineT,
  });
}

function draft(d: DistrictCode, work: QuarterWork): CauseDraft {
  return build(d, work).draft;
}

/**
 * The reported Ghost count of one district, `floor((R + C - O + D) / G)`. The engine passes it to
 * `finish` as `valueOverride`, so the floor, the clamp of R and the zero-population rule land in
 * the Bound_Adjustment.
 */
export function ghostCountValue(d: DistrictCode, work: QuarterWork): number {
  return build(d, work).count;
}

export const ghostCountRule: IndicatorRule = {
  id: INDICATOR_ID,
  unit: 'ghosts',
  valueKind: 'count',
  stage: 'post-migration',
  parameters: specs,
  draft,
  valueOverride: ghostCountValue,
};
