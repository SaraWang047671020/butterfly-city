import { describe, expect, it } from 'vitest';

import { applyAdjustment, checkEditRange } from '../../src/game/core/checks.ts';
import type { EditRequest } from '../../src/game/core/checks.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { convert } from '../../src/data/convert.ts';
import { checkLimit, emptyLedger, planBudget } from '../../src/simulation/budget.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { ScalarParameter } from '../../src/types/simulation.ts';
import { readFixture } from '../data/fixtures/index.ts';

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

  it('above the upper limit', () => {
    const s = build();
    const { upper } = limits(s);
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
    const { upper } = limits(s0);
    const ceiling: ScalarParameter = {
      kind: 'scalar',
      value: 1,
      unit: 'TWD',
      source: { citation: 'Test override', url: '' },
      status: 'verified',
    };
    const s: GameSession = { ...s0, params: { ...s0.params, 'budget.ceiling.rentSubsidy.2015': ceiling } };
    const req: EditRequest = { target: TARGET, kind: 'value', text: String(Math.floor(upper)) };
    const check = checkEditRange(s, req);
    expect(check.status).toBe('budget');
    if (check.status !== 'budget') return;
    expect(check.problem.over).toBeGreaterThan(0);
    unchanged(s, applyAdjustment(s, req).session);
  });
});
