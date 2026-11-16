import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { run } from '../../../src/simulation/engine.ts';
import { arbEngineInputs } from '../arbitraries.ts';

describe('Property 6: Bounded indicators stay in 0–100', () => {
  it('every bounded indicator value of every district and quarter lies in [0, 100]', () => {
    // **Validates: Requirements 12.1, 12.8**
    let checked = 0;
    fc.assert(
      fc.property(
        fc.constantFrom('real-style' as const, 'synthetic' as const).chain((eventMode) =>
          arbEngineInputs({ eventMode }),
        ),
        (inp) => {
          const result = run(
            inp.policies,
            inp.events,
            inp.params,
            inp.baseline,
            inp.realTrack,
            inp.commute,
            inp.target as QuarterKey,
          );
          if (!result.ok) return; // only accepted runs are covered by the property
          for (const state of result.states) {
            for (const ind of state.indicators) {
              if (ind.kind !== 'bounded') continue;
              for (const value of Object.values(state.values[ind.id] ?? {})) {
                expect(Number.isFinite(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(100);
                checked++;
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
