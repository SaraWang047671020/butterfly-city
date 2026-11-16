import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { SimEvent } from '../../../src/types/simulation.ts';
import { run } from '../../../src/simulation/engine.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

function runWith(inp: EngineInputs, events: readonly SimEvent[]) {
  return run(inp.policies, events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey);
}

describe('Property 27: Real-style events add no Event Cause', () => {
  it('equals the empty-event run and has no Event Cause in any breakdown', () => {
    // **Validates: Requirements 11.1, 11.6, 11.7, 11.9, 17.12**
    fc.assert(
      fc.property(arbEngineInputs({ eventMode: 'real-style' }), (inp) => {
        const withEvents = runWith(inp, inp.events);
        const without = runWith(inp, []);
        let sameResult = true;
        let eventCauses = 0;
        try {
          expect(withEvents).toStrictEqual(without);
        } catch {
          sameResult = false;
        }
        if (withEvents.ok) {
          for (const state of withEvents.states) {
            for (const byDistrict of Object.values(state.causes)) {
              for (const breakdown of Object.values(byDistrict)) {
                for (const cause of breakdown.causes) if (cause.kind === 'event') eventCauses++;
              }
            }
          }
        }
        expect(sameResult).toBe(true);
        expect(eventCauses).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);
});
