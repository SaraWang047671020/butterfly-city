// Engine example tests (task 10.3): error details, step on the last quarter, runRange errors and the
// Requirement 17.12 examples. All inputs are in-memory fixtures.

import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../src/types/data-files.ts';
import type {
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  SimEvent,
} from '../../src/types/simulation.ts';
import { run, runRange, step } from '../../src/simulation/engine.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';
import {
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  buildRealStyleEvents,
  buildRealTrack,
  DISTRICT_CODES,
  districtsOf,
  scalar,
} from './fixtures/index.ts';

const NO_EVENTS: readonly SimEvent[] = [];
const TAIPEI = districtsOf('Taipei');

interface Inputs {
  readonly policies: PolicyTimeline;
  readonly events: readonly SimEvent[];
  readonly params: ParameterTable;
  readonly baseline: ReturnType<typeof buildBaseline>;
  readonly realTrack: PolicyTimeline;
}

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  const realTrack = overrides.realTrack ?? buildRealTrack();
  return {
    policies: overrides.policies ?? realTrack,
    events: overrides.events ?? NO_EVENTS,
    params: overrides.params ?? buildParams(),
    baseline: overrides.baseline ?? buildBaseline(),
    realTrack,
  };
}

function runTo(i: Inputs, target: QuarterKey) {
  return run(i.policies, i.events, i.params, i.baseline, i.realTrack, buildCommuteMatrix(), target);
}

/** A copy of the track in which one quarter's unitsStarted values are replaced for some districts. */
function withUnits(
  track: PolicyTimeline,
  quarterIndex: number,
  units: Readonly<Record<string, number>>,
): PolicyTimeline {
  return track.map((setting, q): PolicySetting => {
    if (q !== quarterIndex) return setting;
    const sh = setting.tools['socialHousing'];
    return {
      ...setting,
      tools: {
        ...setting.tools,
        socialHousing: { ...sh, unitsStarted: { ...sh?.['unitsStarted'], ...units } },
      },
    };
  });
}

function lagParam(quarters: number) {
  return scalar(quarters, {
    unit: 'quarters',
    status: 'secondary',
    estimated: 'Median of NLMA portal projects, whole quarters (NLMA derivation, fixture value).',
  });
}

/** Lag 0 and a huge rent coefficient: one extra unit overflows the rent burden. */
function overflowParams(central: number, range: readonly [number, number]): ParameterTable {
  return buildParams({
    overrides: {
      'socialHousing.lag': lagParam(0),
      'socialHousing.rentPerUnit': scalar(central, {
        unit: 'TWD per m2 per month per unit',
        status: 'secondary',
        range,
        estimated: 'Overflow test value.',
      }),
    },
  });
}

describe('engine errors', () => {
  it('stock-negative names the first district and the first quarter', () => {
    const realTrack = buildRealTrack();
    const zeros = Object.fromEntries(DISTRICT_CODES.map((c) => [c, 0]));
    const i = inputs({
      realTrack,
      policies: withUnits(realTrack, 0, zeros),
      params: buildParams({ overrides: { 'socialHousing.lag': lagParam(0) } }),
      baseline: buildBaseline({ socialHousingStock: () => 0 }),
    });
    const result = runTo(i, '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('stock-negative');
    expect(result.error.details).toEqual({ district: DISTRICT_CODES[0], quarter: '2015Q1' });
    expect(result.quarter).toBe('2015Q1');
  });

  it('non-finite is reported for an overflowing coefficient', () => {
    const realTrack = buildRealTrack();
    const i = inputs({
      realTrack,
      policies: withUnits(realTrack, 0, { [DISTRICT_CODES[0] ?? '']: 12 }),
      params: overflowParams(1.7e308, [0, 1.7e308]),
    });
    const result = runTo(i, '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('non-finite');
    expect(result.error.details).toEqual({
      quantity: 'rent',
      district: DISTRICT_CODES[0],
      quarter: '2015Q1',
    });
  });

  it('budget-exceeded reports the year, the Annual_Budget and the committed amount', () => {
    const realTrack = buildRealTrack({ amount: { Taipei: 1, 'New Taipei': 1 } });
    // 80 units per Taipei district in 2015Q1 is exactly the 2x city-year limit (12 x 80 = 960).
    const raised = Object.fromEntries(TAIPEI.map((c) => [c, 80]));
    const i = inputs({ realTrack, policies: withUnits(realTrack, 0, raised) });
    const result = runTo(i, '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('budget-exceeded');
    const unitCost = 7_800_000;
    const nTaipei = TAIPEI.length;
    const realQuarter = DISTRICT_CODES.length * 10 * unitCost;
    // Rent subsidy: 2 cities x 5,000 households x 1 TWD x 3 months, charged in the quarter itself.
    const rentSubsidyQuarter = 2 * 5_000 * 3;
    // Real social housing charges of 2015 after the four-quarter Cost_Schedule: 1 + 3/4 + 2/4 + 1/4 quarters.
    const annualBudget = realQuarter * 2.5 + 4 * rentSubsidyQuarter;
    const committed = realQuarter + nTaipei * 70 * unitCost + rentSubsidyQuarter;
    expect(result.error.details).toEqual({
      year: 2015,
      annualBudget,
      committed,
      over: committed - annualBudget,
    });
  });

  it('ceiling-exceeded reports the tool, the year, the ceiling and the committed amount', () => {
    const params = buildParams({
      overrides: {
        'budget.ceiling.socialHousing.2015': scalar(1_000_000_000, { unit: 'TWD' }),
      },
    });
    const result = runTo(inputs({ params }), '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ceiling-exceeded');
    const committed = DISTRICT_CODES.length * 10 * 7_800_000;
    expect(result.error.details).toEqual({
      tool: 'socialHousing',
      year: 2015,
      ceiling: 1_000_000_000,
      committed,
      over: committed - 1_000_000_000,
    });
  });

  it('limit-exceeded reports the tool, field, city, year, value, side and limit', () => {
    const realTrack = buildRealTrack();
    const first = TAIPEI[0] ?? '';
    const nTaipei = TAIPEI.length;
    const upper = 2 * 10 * 4 * nTaipei; // 2x the real city-year total
    const value = upper + 1 + (nTaipei - 1) * 10; // first district carries the excess
    const i = inputs({ realTrack, policies: withUnits(realTrack, 0, { [first]: upper + 1 }) });
    const result = runTo(i, '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('limit-exceeded');
    expect(result.error.details).toEqual({
      tool: 'socialHousing',
      field: 'unitsStarted',
      area: 'Taipei',
      period: '2015',
      value,
      side: 'upper',
      limit: upper,
      parameterId: 'limit.socialHousing.unitsStarted.upperFactor',
    });
  });

  it('step on a state of 2025Q4 returns no-later-quarter', () => {
    const i = inputs();
    const full = runTo(i, '2025Q4');
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const last = full.states[full.states.length - 1];
    expect(last?.quarter).toBe('2025Q4');
    if (last === undefined) return;
    const result = step(last, i.policies, i.events, i.params, i.baseline, i.realTrack, buildCommuteMatrix());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-later-quarter');
    expect(result.error.details).toEqual({ quarter: '2025Q4' });
  });

  it('runRange error carries the Scenario name', () => {
    const realTrack = buildRealTrack();
    // Central value 0 is fine; the high Scenario takes the overflowing end of the range.
    const result = runRange(
      withUnits(realTrack, 0, { [DISTRICT_CODES[0] ?? '']: 12 }),
      NO_EVENTS,
      overflowParams(0, [-0.002, 1.7e308]),
      buildBaseline(),
      realTrack,
      buildCommuteMatrix(),
      '2015Q1',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.scenario).toBe('high');
    expect(result.quarter).toBe('2015Q1');
    expect(result.error.code).toBe('non-finite');
  });
});

describe('Requirement 17.12 examples', () => {
  it('a table without status returns parameters-invalid with status-missing', () => {
    const { status: _status, ...noStatus } = scalar(1, { unit: 'quarters' });
    const params = buildParams({
      overrides: { 'commuterPass.lag': noStatus as unknown as ReturnType<typeof scalar> },
    });
    const result = runTo(inputs({ params }), '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('parameters-invalid');
    expect(result.error.issues).toContainEqual({
      parameterId: 'commuterPass.lag',
      problem: 'status-missing',
    });
  });

  it('a gap parameter with a value and no assumption returns assumption-missing', () => {
    const params = buildParams({
      overrides: {
        'ghost.sensitivityRent': scalar(0.02, {
          unit: 'share per percentage point',
          status: 'gap',
          estimated: 'No source yet; fixture value.',
        }),
      },
    });
    const result = runTo(inputs({ params }), '2015Q1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('parameters-invalid');
    expect(result.error.issues).toContainEqual({
      parameterId: 'ghost.sensitivityRent',
      problem: 'assumption-missing',
    });
  });

  it.each([11, 21])('a social housing Lag of %i quarters is accepted', (lag) => {
    const params = buildParams({ overrides: { 'socialHousing.lag': lagParam(lag) } });
    const result = runTo(inputs({ params }), '2015Q1');
    expect(result.ok).toBe(true);
  });

  it('a table without Event-modifier parameters and real-style events gives zero Event Causes', () => {
    const realTrack = buildRealTrack();
    const i = inputs({
      realTrack,
      // Cost-neutral change: two more units in one district, two fewer in another, so the budget holds.
      policies: withUnits(realTrack, 4, {
        [DISTRICT_CODES[0] ?? '']: 12,
        [DISTRICT_CODES[1] ?? '']: 8,
      }),
      events: buildRealStyleEvents(),
    });
    const result = runTo(i, quarterAt(12));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let eventCauses = 0;
    for (const state of result.states) {
      for (const byDistrict of Object.values(state.causes)) {
        for (const breakdown of Object.values(byDistrict)) {
          eventCauses += breakdown.causes.filter((c) => c.kind === 'event').length;
        }
      }
    }
    expect(eventCauses).toBe(0);
  });
});
