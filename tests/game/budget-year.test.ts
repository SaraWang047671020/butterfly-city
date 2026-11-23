// The year-end projection of an edit (play-loop task 9) predicts the Computation_Run: for every value Apply accepts,
// the run stops on the budget in the same year exactly when the projection names an overrun, and in that quarter.
// The projection is a warning in the Quick_Preview, not a rejection: the player may spend more now and lower the
// value before the overrun quarter (the built-in demo does this).
import { describe, expect, it } from 'vitest';

import { applyAdjustment, checkEditRange } from '../../src/game/core/checks.ts';
import type { EditRequest } from '../../src/game/core/checks.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { fastForward } from '../../src/game/core/turns.ts';
import { convert } from '../../src/data/convert.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
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

describe('year-end projection of an edit', () => {
  it('names an overrun exactly when the run stops on the budget, in the same quarter', () => {
    const s = build();
    let withOverrun = 0;
    let without = 0;
    for (let v = 0; v <= 200000; v += 2000) {
      const req: EditRequest = { target: TARGET, kind: 'value', text: String(v) };
      const check = checkEditRange(s, req);
      if (check.status !== 'ok') continue;
      const { session } = applyAdjustment(s, req);
      const out = fastForward(session);
      const stop = out.carried !== null && out.carried.problem.kind === 'budget' && out.carried.quarter.startsWith('2015') ? out.carried.quarter : null;
      const predicted = check.yearEnd?.overrun?.quarter ?? null;
      expect(stop, `value ${v}`).toBe(predicted);
      if (predicted === null) without += 1;
      else withOverrun += 1;
    }
    expect(without).toBeGreaterThan(0);
    expect(withOverrun).toBeGreaterThan(0);
  });
});
