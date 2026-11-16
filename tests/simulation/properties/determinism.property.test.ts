import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { run, runRange } from '../../../src/simulation/engine.ts';
import { arbEngineInputs } from '../arbitraries.ts';

describe('Property 2: Determinism', () => {
  it('run and runRange return deep-equal results on a structuredClone of every argument', () => {
    // **Validates: Requirements 1.11, 17.7**
    fc.assert(
      fc.property(
        fc.constantFrom('real-style' as const, 'synthetic' as const).chain((eventMode) =>
          arbEngineInputs({ eventMode }),
        ),
        (inputs) => {
          const { policies, events, params, baseline, realTrack, commute } = inputs;
          const target = inputs.target as QuarterKey;
          const first = run(policies, events, params, baseline, realTrack, commute, target);
          const second = run(
            structuredClone(policies),
            structuredClone(events),
            structuredClone(params),
            structuredClone(baseline),
            structuredClone(realTrack),
            structuredClone(commute),
            structuredClone(target),
          );
          expect(second).toEqual(first);

          const firstRange = runRange(policies, events, params, baseline, realTrack, commute, target);
          const secondRange = runRange(
            structuredClone(policies),
            structuredClone(events),
            structuredClone(params),
            structuredClone(baseline),
            structuredClone(realTrack),
            structuredClone(commute),
            structuredClone(target),
          );
          expect(secondRange).toEqual(firstRange);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
