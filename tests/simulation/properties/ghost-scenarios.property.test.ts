import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { derivedMeanCommuteTime } from '../../../src/simulation/derived.ts';
import { runRange } from '../../../src/simulation/engine.ts';
import { computeGhostValues, derivedGhostCount } from '../../../src/simulation/ghosts.ts';
import { scenarioTable } from '../../../src/simulation/params.ts';
import { arbEngineInputs, type PlayerMode } from '../arbitraries.ts';

const GHOST = 'ghostCount';

// Zero deltas: the player timeline equals the real track. Zero-population districts are valid.
const arbInputs = arbEngineInputs({ playerMode: 'equal-to-real' as PlayerMode, eventMode: 'real-style' });

describe('Property 28: Ghost count follows the Scenario threshold', () => {
  it('at zero deltas each Scenario count is exactly its own Derived_Baseline count and the other Causes are 0', () => {
    // **Validates: Requirements 19.8, 10.8**
    fc.assert(
      fc.property(arbInputs, (inp) => {
        const result = runRange(
          inp.policies, inp.events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        let bad = 0;
        let cells = 0;
        for (const name of ['central', 'low', 'high'] as const) {
          const table = scenarioTable(inp.params, name);
          result[name].forEach((state, q) => {
            const quarter = inp.baseline.quarters[q];
            for (const [code, value] of Object.entries(state.values[GHOST] ?? {})) {
              cells += 1;
              const p0 = inp.baseline.indicators.population?.[code]?.[q];
              const t0 = quarter === undefined ? null : derivedMeanCommuteTime(table, inp.commute, code, quarter);
              if (typeof p0 !== 'number' || t0 === null || !t0.ok) {
                bad += 1;
                continue;
              }
              if (value !== derivedGhostCount(table, p0, t0.value)) bad += 1;
              const causes = state.causes[GHOST]?.[code]?.causes ?? [];
              if (causes.length === 0 || causes[0]?.id !== 'baseline' || causes[0].contribution !== value) bad += 1;
              for (const c of causes.slice(1)) if (c.contribution !== 0) bad += 1;
            }
          });
        }
        expect(cells).toBeGreaterThan(0);
        expect(bad).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('the low Scenario has at least the commute group C and Ghost count of the high Scenario', () => {
    // **Validates: Requirements 10.8, 19.8**
    fc.assert(
      fc.property(arbInputs, (inp) => {
        const result = runRange(
          inp.policies, inp.events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const low = scenarioTable(inp.params, 'low');
        const high = scenarioTable(inp.params, 'high');
        let bad = 0;
        let cells = 0;
        result.low.forEach((lowState, q) => {
          const highState = result.high[q];
          const quarter = inp.baseline.quarters[q];
          for (const [code, lowCount] of Object.entries(lowState.values[GHOST] ?? {})) {
            cells += 1;
            const highCount = highState?.values[GHOST]?.[code];
            const p0 = inp.baseline.indicators.population?.[code]?.[q];
            const tl = quarter === undefined ? null : derivedMeanCommuteTime(low, inp.commute, code, quarter);
            const th = quarter === undefined ? null : derivedMeanCommuteTime(high, inp.commute, code, quarter);
            if (highCount === undefined || typeof p0 !== 'number' || !tl?.ok || !th?.ok) {
              bad += 1;
              continue;
            }
            const lowC = computeGhostValues(low, { population: p0, commuteTime: tl.value, displaced: 0, groups: [] }, p0, tl.value).commute;
            const highC = computeGhostValues(high, { population: p0, commuteTime: th.value, displaced: 0, groups: [] }, p0, th.value).commute;
            if (!(lowC >= highC) || !(lowCount >= highCount)) bad += 1;
          }
        });
        expect(cells).toBeGreaterThan(0);
        expect(bad).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);
});
