// Compile-time test: every engine input and state type is deeply readonly.
// `npm run typecheck` fails if any `@ts-expect-error` below stops erroring.
// The function is never called; it only has to type-check.
import type {
  EngineBaseline,
  CommuteMatrix,
  ParameterTable,
  PolicyTimeline,
  ScalarParameter,
  ScheduleParameter,
  SimEvent,
  SimState,
} from '../../src/types/simulation.ts';

export function readonlyTypeChecks(
  table: ParameterTable,
  baseline: EngineBaseline,
  timeline: PolicyTimeline,
  matrix: CommuteMatrix,
  event: SimEvent,
  state: SimState,
  scalar: ScalarParameter,
  schedule: ScheduleParameter,
): void {
  // ParameterTable
  // @ts-expect-error record entry is readonly
  table['p'] = scalar;
  // @ts-expect-error scalar field is readonly
  scalar.value = 1;
  // @ts-expect-error nested citation field is readonly
  scalar.source.url = 'x';
  // @ts-expect-error nested range field is readonly
  if (scalar.range) scalar.range.low = 1;
  // @ts-expect-error nested range citation field is readonly
  if (scalar.range) scalar.range.lowSource.url = 'x';
  // @ts-expect-error estimated field is readonly
  if (scalar.estimated) scalar.estimated.method = 'x';
  // @ts-expect-error schedule offsets array is readonly
  schedule.offsets.push(1);
  // @ts-expect-error schedule shares array is readonly
  schedule.shares.push(1);
  // @ts-expect-error schedule field is readonly
  schedule.unit = 'x';

  // EngineBaseline
  // @ts-expect-error field is readonly
  baseline.sourceIds = [];
  // @ts-expect-error quarters array is readonly
  baseline.quarters.push('2015Q1');
  // @ts-expect-error districts array is readonly
  baseline.districts.push({ code: '63000010', city: 'Taipei' });
  // @ts-expect-error district entry field is readonly
  if (baseline.districts[0]) baseline.districts[0].code = 'x';
  // @ts-expect-error indicators record entry is readonly
  baseline.indicators['i'] = {};
  // @ts-expect-error per-district record entry is readonly
  if (baseline.indicators['i']) baseline.indicators['i']['d'] = [];
  // @ts-expect-error series array is readonly
  baseline.indicators['i']?.['d']?.push(1);
  // @ts-expect-error indicatorSources array is readonly
  baseline.indicatorSources['i']?.push('s');
  // @ts-expect-error sourceIds array is readonly
  baseline.sourceIds.push('s');

  // PolicyTimeline
  // @ts-expect-error timeline array is readonly
  timeline.push({ quarter: '2015Q1', tools: {} });
  // @ts-expect-error setting field is readonly
  if (timeline[0]) timeline[0].quarter = '2015Q2';
  // @ts-expect-error tools record entry is readonly
  if (timeline[0]) timeline[0].tools['t'] = {};
  // @ts-expect-error field record entry is readonly
  if (timeline[0]) timeline[0].tools['t']!['f'] = {};
  // @ts-expect-error area value is readonly
  if (timeline[0]) timeline[0].tools['t']!['f']!['a'] = 1;

  // CommuteMatrix
  // @ts-expect-error field is readonly
  matrix.codes = [];
  // @ts-expect-error codes array is readonly
  matrix.codes.push('x');
  // @ts-expect-error minutes outer array is readonly
  matrix.minutes.push([]);
  // @ts-expect-error minutes inner array is readonly
  matrix.minutes[0]?.push(1);
  // @ts-expect-error minutes cell is readonly
  if (matrix.minutes[0]) matrix.minutes[0][0] = 1;

  // SimEvent
  // @ts-expect-error field is readonly
  event.id = 'x';
  // @ts-expect-error affectedIndicators array is readonly
  event.affectedIndicators.push('x');
  // @ts-expect-error magnitude field is readonly
  event.magnitude.text = 'x';
  // @ts-expect-error sources array is readonly
  event.sources.push('x');
  // @ts-expect-error modifiers array is readonly
  event.modifiers.push({ tool: 't', parameterId: 'p' });
  // @ts-expect-error modifier field is readonly
  if (event.modifiers[0]) event.modifiers[0].parameterId = 'x';

  // SimState
  // @ts-expect-error field is readonly
  state.quarter = '2015Q1';
  // @ts-expect-error indicators array is readonly
  state.indicators.push({ id: 'i', unit: 'u', kind: 'observed' as never });
  // @ts-expect-error indicator entry field is readonly
  if (state.indicators[0]) state.indicators[0].unit = 'x';
  // @ts-expect-error values record entry is readonly
  state.values['i'] = {};
  // @ts-expect-error values district entry is readonly
  if (state.values['i']) state.values['i']['d'] = 1;
  // @ts-expect-error causes record entry is readonly
  state.causes['i'] = {};
  // @ts-expect-error cause breakdown field is readonly
  if (state.causes['i']?.['d']) state.causes['i']['d'].value = 1;
  // @ts-expect-error causes array is readonly
  state.causes['i']?.['d']?.causes.push();
  // @ts-expect-error lag pipeline array is readonly
  state.lagPipeline.push({ tool: 't', area: 'a', committed: '2015Q1', effect: '2015Q1', value: 1 });
  // @ts-expect-error lag entry field is readonly
  if (state.lagPipeline[0]) state.lagPipeline[0].value = 1;
  // @ts-expect-error ledger field is readonly
  state.ledger.remaining = 1;
  // @ts-expect-error ledger committed array is readonly
  state.ledger.committed['t']?.push(1);
  // @ts-expect-error ledger committed slot is readonly
  if (state.ledger.committed['t']) state.ledger.committed['t'][0] = 1;
  // @ts-expect-error migration field is readonly
  state.migration.exits = 1;
  // @ts-expect-error migration displaced entry is readonly
  state.migration.displaced['d'] = 1;
  // @ts-expect-error migration movedIn entry is readonly
  state.migration.movedIn['d'] = 1;
  // @ts-expect-error carry field is readonly
  state.carry.stock = {};
  // @ts-expect-error carry stock tool entry is readonly
  state.carry.stock['t'] = {};
  // @ts-expect-error carry stock area entry is readonly
  state.carry.stock['t']!['a'] = 1;
}
