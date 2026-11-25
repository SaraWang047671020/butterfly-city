import { describe, expect, it } from 'vitest';

import { affordableValue, applyAdjustment, checkEditRange, checkEditSync } from '../../src/game/core/checks.ts';
import type { EditRequest } from '../../src/game/core/checks.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { convert } from '../../src/data/convert.ts';
import { checkLimit, emptyLedger, planBudget } from '../../src/simulation/budget.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { ScalarParameter } from '../../src/types/simulation.ts';
import { readFixture } from '../data/fixtures/index.ts';

/** The fixture session without the Documented_Limits of the target field. */
function buildNoMax(): GameSession {
  const s = build();
  const params = Object.fromEntries(Object.entries(s.params).filter(([id]) => !id.startsWith('limit.rentSubsidy.households.max')));
  return { ...s, params };
}

function build(): GameSession {
  const data = convert({
    districts: readFixture('districts.json'),
    history: readFixture('history.json'),
    policyTrack: readFixture('policy-track.json'),
    events: readFixture('events.json'),
    params: readFixture('params.json'),
    commute: readFixture('commute-matrix.json'),
  });
  return newSession(data, RULE_REGISTRY);
}

const TARGET = { tool: 'rentSubsidy', field: 'households', area: 'Taipei' } as const;

function limits(s: GameSession): { lower: number; upper: number } {
  const ctx = { params: s.params, baseline: s.baseline, realTrack: s.realTrack, commute: s.commute };
  const ledger = emptyLedger(planBudget(s.realTrack, s.params, s.registry.tools, ctx));
  const info = checkLimit('rentSubsidy', 'households', 'Taipei', '2015Q1', ledger, s.params, s.registry.tools, ctx);
  return { lower: info.lower, upper: info.upper };
}

function unchanged(before: GameSession, after: GameSession): void {
  expect(after.diffs).toEqual(before.diffs);
  expect(after.timeline).toEqual(before.timeline);
}

describe('no Documented_Limit (housing-tools Requirement 2.2)', () => {
  it('a field without a max has no upper limit; the budget decides', () => {
    expect(limits(buildNoMax()).upper).toBe(Number.POSITIVE_INFINITY);
  });

  it('the slider ends at the largest value the budget of the year allows, kept to the end of the year', () => {
    const s = buildNoMax();
    const end = affordableValue(s, TARGET, true);
    expect(Number.isInteger(end)).toBe(true);
    const at = checkEditSync(s, { target: TARGET, kind: 'value', text: String(end) });
    const over = checkEditSync(s, { target: TARGET, kind: 'value', text: String(end + 1) });
    // Kept to the end of the year: the end fits with no overrun, one more does not (a rejection or a year-end overrun).
    expect(['pending-range', 'unchanged']).toContain(at.status);
    if (at.status === 'pending-range') expect(at.yearEnd?.overrun ?? null).toBeNull();
    const overruns = over.status === 'budget' || (over.status === 'pending-range' && (over.yearEnd?.overrun ?? null) !== null);
    expect(overruns).toBe(true);
  });
});

describe('rejected edits leave diffs and Timeline_Entries unchanged (19.2, 9.2, 9.3, 9.5)', () => {
  it('below the lower limit', () => {
    const s = build();
    const { lower } = limits(s);
    const req: EditRequest = { target: TARGET, kind: 'value', text: String(Math.floor(lower) - 1) };
    const { check, session } = applyAdjustment(s, req);
    expect(check.status).toBe('limit');
    if (check.status !== 'limit') return;
    expect(check.limit.side).toBe('lower');
    expect(check.limit.limit).toBe(lower);
    unchanged(s, session);
  });

  it('above a Documented_Limit (housing-tools: an area and year specific max)', () => {
    const s0 = build();
    const max: ScalarParameter = { kind: 'scalar', value: 50_000, unit: 'households', source: { citation: 'Test limit', url: '' }, status: 'verified' };
    const s: GameSession = { ...s0, params: { ...buildNoMax().params, 'limit.rentSubsidy.households.max.Taipei.2015': max } };
    const { upper } = limits(s);
    expect(upper).toBe(50_000);
    const req: EditRequest = { target: TARGET, kind: 'value', text: String(Math.ceil(upper) + 1) };
    const { check, session } = applyAdjustment(s, req);
    expect(check.status).toBe('limit');
    if (check.status !== 'limit') return;
    expect(check.limit.side).toBe('upper');
    expect(check.limit.limit).toBe(upper);
    unchanged(s, session);
  });

  it('over the budget (tool ceiling forced below the real charge)', () => {
    const s0 = build();
    const ceiling: ScalarParameter = {
      kind: 'scalar',
      value: 1,
      unit: 'TWD',
      source: { citation: 'Test override', url: '' },
      status: 'verified',
    };
    const s: GameSession = { ...s0, params: { ...s0.params, 'budget.ceiling.rentSubsidy.2015': ceiling } };
    const req: EditRequest = { target: TARGET, kind: 'value', text: '1000' };
    const check = checkEditRange(s, req);
    expect(check.status).toBe('budget');
    if (check.status !== 'budget') return;
    expect(check.problem.over).toBeGreaterThan(0);
    unchanged(s, applyAdjustment(s, req).session);
  });
});
