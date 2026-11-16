import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { PolicyTimeline } from '../../../src/types/simulation.ts';
import { run } from '../../../src/simulation/engine.ts';
import { arbEngineInputs, type EngineInputs } from '../arbitraries.ts';

const GHOST = 'ghostCount';

/** The tool whose value differs from the Real_Policy_Track (the generator changes exactly one field). */
function changedTool(policies: PolicyTimeline, real: PolicyTimeline): string | null {
  let found: string | null = null;
  policies.forEach((s, q) => {
    for (const [tool, fields] of Object.entries(s.tools)) {
      for (const [field, areas] of Object.entries(fields)) {
        for (const [area, v] of Object.entries(areas)) {
          if (v !== real[q]?.tools[tool]?.[field]?.[area]) found = tool;
        }
      }
    }
  });
  return found;
}

function exec(inp: EngineInputs, policies: PolicyTimeline) {
  return run(policies, inp.events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey, {
    budgetMode: 'record',
  });
}

describe('Property 29: Helping direction never raises the Ghost count (central Scenario)', () => {
  it('has Ghost count <= zero-delta run for every district and quarter, and equal for the commuter pass', () => {
    // **Validates: Requirements 4.18, 6.14, 17.2, 17.13**
    let accepted = 0;
    let moved = 0;
    const seen: Record<string, number> = {};
    fc.assert(
      fc.property(arbEngineInputs({ playerMode: 'helping-direction', eventMode: 'real-style' }), (inp) => {
        const helped = exec(inp, inp.policies);
        // Policy_Limit and other precondition errors discard the case.
        fc.pre(helped.ok);
        if (!helped.ok) return;
        const zero = exec(inp, inp.realTrack);
        expect(zero.ok).toBe(true);
        if (!zero.ok) return;
        accepted += 1;
        const tool = changedTool(inp.policies, inp.realTrack);
        if (tool !== null) {
          moved += 1;
          seen[tool] = (seen[tool] ?? 0) + 1;
        }

        let above = 0;
        let notEqual = 0;
        let cells = 0;
        helped.states.forEach((s, q) => {
          const hv = s.values[GHOST] ?? {};
          const zv = zero.states[q]?.values[GHOST] ?? {};
          for (const [code, g] of Object.entries(hv)) {
            cells += 1;
            const z = zv[code];
            if (z === undefined || g > z) above += 1;
            if (tool === 'commuterPass' && g !== z) notEqual += 1;
          }
        });
        expect(cells).toBeGreaterThan(0);
        expect(above).toBe(0);
        expect(notEqual).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
    expect(accepted).toBeGreaterThanOrEqual(20);
    expect(moved).toBeGreaterThan(0);
    expect(Object.keys(seen).length).toBeGreaterThan(0);
  }, 120_000);
});
