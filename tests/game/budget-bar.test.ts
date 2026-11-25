// housing-tools Requirement 3: the Budget_Bar and the cost of an edit count the year with the values kept to its end.
import { describe, expect, it } from 'vitest';

import { checkEditSync } from '../../src/game/core/checks.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { buildGameView } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { convert } from '../../src/data/convert.ts';
import type { LoadedData } from '../../src/data/convert.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import { readFixture } from '../data/fixtures/index.ts';

const UI: ControllerUiState = {
  busy: false,
  storageWarning: false,
  versionNotice: null,
  engineError: null,
  carried: null,
  drafts: new Map(),
  dialog: null,
  announcement: null,
  focusRequest: null,
};

function data(): LoadedData {
  return convert({
    districts: readFixture('districts.json'),
    history: readFixture('history.json'),
    policyTrack: readFixture('policy-track.json'),
    events: readFixture('events.json'),
    params: readFixture('params.json'),
    commute: readFixture('commute-matrix.json'),
  });
}

const TARGET = { tool: 'rentSubsidy', field: 'households', area: 'Taipei' } as const;

describe('Budget_Bar', () => {
  it('on the real track nothing is left at the end of the year: the Annual_Budget is the real spending', () => {
    const d = data();
    const s: GameSession = newSession(d, RULE_REGISTRY);
    const bar = buildGameView(s, UI, d).turnBar.budget;
    expect(bar).not.toBeNull();
    if (bar === null) return;
    const total = bar.tools.reduce((a, t) => a + t.spent + t.later, 0);
    expect(total + bar.remaining).toBeCloseTo(bar.annualBudget, 0);
    expect(Math.abs(bar.remaining)).toBeLessThan(1);
    // The holding tax spends nothing: it changes the year's total, so it has no segment.
    expect(bar.tools.map((t) => t.tool)).toEqual(RULE_REGISTRY.tools.map((t) => t.id).filter((id) => id !== 'holdingTax'));
  });

  it('an edit costs its charges of the year kept to the end; lowering a tool frees money', () => {
    const s = newSession(data(), RULE_REGISTRY);
    const lower = checkEditSync(s, { target: TARGET, kind: 'value', text: '0' });
    expect(lower.status).toBe('pending-range');
    if (lower.status !== 'pending-range') return;
    expect(lower.costYear).toBeLessThan(0);
    expect(lower.costTotal).toBeLessThanOrEqual(0);
    expect(lower.yearEnd?.remaining).toBeCloseTo(-(lower.costYear ?? 0), 0);
  });
});
