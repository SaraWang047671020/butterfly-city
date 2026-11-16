// Rent burden indicator rule (Requirements 2.1, 2.5, 4.15, 6.4, 6.5, 12.1, 13.4). Bounded 0 to 100.
// Start value: the Derived_Baseline clamp(rent x S / (I / 12) x 100, 0, 100).
// Tool Causes: the social housing and rent subsidy deltas computed by their tool rules (direct term plus
// spillover or pass-through follow-on). The tool Cause keeps the value without Event modifiers; Event Causes
// carry what the modifiers added or removed (11.4).

import type { DistrictCode } from '../../types/data-files.ts';
import type {
  CauseDraft,
  CauseLinks,
  Contribution,
  IndicatorRule,
  ParameterSpec,
  QuarterWork,
} from '../../types/simulation.ts';
import { derivedRentBurden } from '../derived.ts';

const INDICATOR_ID = 'rentBurden';
const NO_LINKS: CauseLinks = { parameterIds: [], sourceIds: [] };

function plain(x: number): number {
  return x === 0 ? 0 : x;
}

function draft(d: DistrictCode, work: QuarterWork): CauseDraft {
  const { ctx } = work;
  const derived = derivedRentBurden(ctx.baseline, ctx.params, d, work.quarterIndex);
  // No error channel in a draft: NaN is reported by the stage-9 finite check.
  const start: Contribution = {
    value: derived.ok ? derived.value : Number.NaN,
    links: {
      parameterIds: ['housing.dwellingSize'],
      sourceIds: [
        ...(ctx.baseline.indicatorSources['rent'] ?? []),
        ...(ctx.baseline.indicatorSources['householdIncome'] ?? []),
      ].sort(),
    },
  };

  const tools: (Contribution & { readonly tool: string })[] = [];
  const events: (Contribution & { readonly eventId: string })[] = [];
  for (const [tool, effects] of Object.entries(work.effects)) {
    const modified = effects.deltas[INDICATOR_ID]?.[d] ?? 0;
    const toolEvents = work.eventContributions[tool]?.[INDICATOR_ID]?.[d] ?? [];
    let eventSum = 0;
    for (const e of toolEvents) {
      eventSum += e.value;
      events.push(e);
    }
    // effects hold the modified delta v = u + sum of Event Causes; the tool Cause is u.
    tools.push({
      tool,
      value: plain(toolEvents.length === 0 ? modified : modified - eventSum),
      links: effects.links[INDICATOR_ID] ?? NO_LINKS,
    });
  }

  return {
    kind: 'bounded',
    start,
    tools,
    events,
    migration: { value: 0, links: NO_LINKS },
  };
}

function parameters(): readonly ParameterSpec[] {
  // housing.dwellingSize and the household parameters are declared by the tool rules that use them.
  return [];
}

export const rentBurdenRule: IndicatorRule = {
  id: INDICATOR_ID,
  unit: 'percent',
  valueKind: 'bounded',
  stage: 'pre-migration',
  parameters,
  draft,
};
