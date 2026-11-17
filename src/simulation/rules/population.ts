// Population indicator rule (Requirement 9.5, 9.8). Stage post-migration.
// Value = Baseline population of the quarter + the migration Cause (persons moved in minus persons
// moved out in this quarter). Conflict C2: the Baseline already holds earlier migration, so nothing
// is carried over from quarter to quarter.

import type { DistrictCode } from '../../types/data-files.ts';
import type {
  CauseDraft,
  CauseLinks,
  Contribution,
  IndicatorRule,
  ParameterSpec,
  QuarterWork,
} from '../../types/simulation.ts';

const INDICATOR_ID = 'population';

export const MIGRATION_PARAMETER_IDS: readonly string[] = [
  'migration.commuteCostPerMinute',
  'migration.exitShare',
  'migration.share',
  'migration.threshold',
  'migration.weightBurden',
  'migration.weightCost',
  'migration.weightTime',
];

const EMPTY_LINKS: CauseLinks = { parameterIds: [], sourceIds: [] };

function migrationSpecs(): readonly ParameterSpec[] {
  return [
    { id: 'migration.threshold', role: 'derivation', check: { kind: 'non-negative' } },
    { id: 'migration.share', role: 'derivation', check: { kind: 'share' } },
    { id: 'migration.exitShare', role: 'derivation', check: { kind: 'share' } },
    { id: 'migration.weightTime', role: 'derivation', check: { kind: 'non-negative' } },
    { id: 'migration.weightBurden', role: 'derivation', check: { kind: 'non-negative' } },
    { id: 'migration.weightCost', role: 'derivation', check: { kind: 'non-negative' } },
    { id: 'migration.commuteCostPerMinute', role: 'effect', check: { kind: 'non-negative' } },
  ];
}

function baselinePopulation(work: QuarterWork, d: DistrictCode): number {
  const series = work.ctx.baseline.indicators[INDICATOR_ID];
  if (series === undefined || !Object.hasOwn(series, d)) return Number.NaN;
  const v = series[d]?.[work.quarterIndex];
  return typeof v === 'number' ? v : Number.NaN;
}

function draft(d: DistrictCode, work: QuarterWork): CauseDraft {
  const start: Contribution = {
    value: baselinePopulation(work, d),
    links: {
      parameterIds: [],
      sourceIds: [...(work.ctx.baseline.indicatorSources[INDICATOR_ID] ?? [])],
    },
  };

  // Registry tool order is the key order of the effects record. No tool changes population here,
  // so each value is 0 unless a tool reports a delta for this indicator.
  const tools = Object.keys(work.effects).map((tool) => {
    const effects = work.effects[tool];
    const delta = effects?.deltas[INDICATOR_ID]?.[d];
    return {
      tool,
      value: typeof delta === 'number' ? delta : 0,
      links: effects?.links[INDICATOR_ID] ?? EMPTY_LINKS,
    };
  });

  const events: (Contribution & { readonly eventId: string })[] = [];
  for (const tool of Object.keys(work.eventContributions)) {
    const list = work.eventContributions[tool]?.[INDICATOR_ID]?.[d];
    if (list !== undefined) events.push(...list);
  }

  const net = work.migration?.net[d] ?? 0;
  const migration: Contribution = {
    value: net,
    links: { parameterIds: MIGRATION_PARAMETER_IDS, sourceIds: [] },
  };

  return { kind: 'count', start, tools, events, migration };
}

export const populationRule: IndicatorRule = {
  id: INDICATOR_ID,
  unit: 'persons',
  valueKind: 'count',
  stage: 'post-migration',
  parameters: migrationSpecs,
  draft,
};
