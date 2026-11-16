// MRT entries indicator (Requirements 2.1, 2.5, 5.7, 5.8, 5.9, 12.2, 12.6).
// Value = Baseline entries + the commuter pass delta + Event Causes. A district without a station has
// Baseline 0 and so a delta of 0. Kind non-negative (below 0 is limited to 0 through finish),
// stage pre-migration.
// Pure functions. Inputs are never mutated.

import type { DistrictCode } from '../../types/data-files.ts';
import type {
  CauseDraft,
  CauseLinks,
  Contribution,
  IndicatorRule,
  ParameterSpec,
  QuarterWork,
} from '../../types/simulation.ts';

const INDICATOR_ID = 'mrtEntries';
const EMPTY_LINKS: CauseLinks = { parameterIds: [], sourceIds: [] };

function sortedSources(work: QuarterWork): readonly string[] {
  const s = work.ctx.baseline.indicatorSources;
  return Object.hasOwn(s, INDICATOR_ID) ? [...(s[INDICATOR_ID] ?? [])].sort() : [];
}

/** Baseline value of the quarter; NaN when absent, which the engine's finite check reports (15.3). */
function baselineValue(d: DistrictCode, work: QuarterWork): number {
  const series = work.ctx.baseline.indicators[INDICATOR_ID];
  if (series === undefined || !Object.hasOwn(series, d)) return Number.NaN;
  const v = series[d]?.[work.quarterIndex];
  return typeof v === 'number' ? v : Number.NaN;
}

function draft(d: DistrictCode, work: QuarterWork): CauseDraft {
  const tools: (Contribution & { readonly tool: string })[] = [];
  const events: (Contribution & { readonly eventId: string })[] = [];

  for (const tool of Object.keys(work.effects)) {
    const effects = work.effects[tool];
    const delta = effects?.deltas[INDICATOR_ID]?.[d] ?? 0;
    const toolEvents = work.eventContributions[tool]?.[INDICATOR_ID]?.[d] ?? [];
    // `delta` is the modified value; the tool Cause keeps the unmodified effect and the Event Causes
    // carry the difference, so the two sum to the delta (11.4).
    const eventSum = toolEvents.reduce((acc, e) => acc + e.value, 0);
    tools.push({ tool, value: delta - eventSum, links: effects?.links[INDICATOR_ID] ?? EMPTY_LINKS });
    for (const e of toolEvents) events.push(e);
  }

  return {
    kind: 'non-negative',
    start: { value: baselineValue(d, work), links: { parameterIds: [], sourceIds: sortedSources(work) } },
    tools,
    events,
    migration: { value: 0, links: EMPTY_LINKS },
  };
}

export const mrtEntriesRule: IndicatorRule = {
  id: INDICATOR_ID,
  unit: 'entries per quarter',
  valueKind: 'non-negative',
  stage: 'pre-migration',
  parameters(): readonly ParameterSpec[] {
    return [];
  },
  draft,
};
