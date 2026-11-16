import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { SimEvent } from '../../../src/types/simulation.ts';
import { run } from '../../../src/simulation/engine.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

function runWith(inp: EngineInputs, policies: EngineInputs['policies'], events: readonly SimEvent[]) {
  return run(policies, events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey);
}

/** Changes only the display-only fields of every event. */
function scrambleDisplay(events: readonly SimEvent[], salt: number, ids: readonly string[]): readonly SimEvent[] {
  return events.map((e, i) => ({
    ...e,
    type: `${e.type}-changed-${salt}-${i}`,
    affectedIndicators: salt % 2 === 0 ? [] : ids.slice(salt % 3),
    magnitude: { text: `Changed text ${salt}.`, value: salt * 1.5 + i, unit: 'other unit' },
  }));
}

describe('Property 18: Events never move indicators on their own', () => {
  it('equals the empty-event run when the player timeline equals the real track', () => {
    // **Validates: Requirements 11.1, 11.7, 11.8**
    fc.assert(
      fc.property(
        arbEngineInputs({ playerMode: 'equal-to-real', eventMode: 'synthetic' }),
        (inp) => {
          const withEvents = runWith(inp, inp.realTrack, inp.events);
          const without = runWith(inp, inp.realTrack, []);
          expect(withEvents.ok).toBe(true);
          expect(withEvents.ok && without.ok ? withEvents.states : null).toStrictEqual(
            withEvents.ok && without.ok ? without.states : null,
          );
        },
      ),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('is unchanged by display-only event fields, and by removing an event without a modifier', () => {
    // **Validates: Requirements 11.1, 11.7, 11.8**
    fc.assert(
      fc.property(
        arbEngineInputs({ eventMode: 'synthetic' }),
        fc.integer({ min: 0, max: 1000 }),
        (inp, salt) => {
          const base = runWith(inp, inp.policies, inp.events);
          const changed = runWith(inp, inp.policies, scrambleDisplay(inp.events, salt, Object.keys(inp.baseline.indicators)));
          const pruned = runWith(
            inp,
            inp.policies,
            inp.events.filter((e) => e.modifiers.length > 0),
          );
          expect(changed).toStrictEqual(base);
          expect(pruned).toStrictEqual(base);
        },
      ),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);
});

