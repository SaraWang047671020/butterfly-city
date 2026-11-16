import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/simulation/engine.ts';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { EngineBaseline, SimState } from '../../../src/types/simulation.ts';
import { arbEngineInputs } from '../arbitraries.ts';

/** Population totals are integers well below 2^53, so exact equality is safe. */
function violations(state: SimState, baseline: EngineBaseline, quarterIndex: number): string[] {
  const bad: string[] = [];
  const { displaced, movedIn, exits } = state.migration;
  const population = state.values['population'];
  const causes = state.causes['population'];
  if (population === undefined || causes === undefined) return ['no population indicator'];

  let out = 0;
  let inn = 0;
  for (const v of Object.values(displaced)) out += v;
  for (const v of Object.values(movedIn)) inn += v;
  if (out !== inn + exits) bad.push(`${state.quarter}: out ${out} != in ${inn} + exits ${exits}`);

  let baseTotal = 0;
  let total = 0;
  for (const d of baseline.districts) {
    const code = d.code;
    const base = baseline.indicators['population']?.[code]?.[quarterIndex];
    if (typeof base !== 'number') {
      bad.push(`${state.quarter}: no baseline population for ${code}`);
      continue;
    }
    baseTotal += base;
    const value = population[code];
    if (value === undefined) {
      bad.push(`${state.quarter}: no population value for ${code}`);
      continue;
    }
    total += value;
    const expected = (movedIn[code] ?? 0) - (displaced[code] ?? 0);
    const migrationCauses = (causes[code]?.causes ?? []).filter((c) => c.kind === 'migration');
    let sum = 0;
    for (const c of migrationCauses) sum += c.contribution;
    if (sum !== expected) bad.push(`${state.quarter} ${code}: migration cause ${sum} != in - out ${expected}`);
  }
  if (total !== baseTotal - exits) bad.push(`${state.quarter}: total ${total} != baseline ${baseTotal} - exits ${exits}`);
  return bad;
}

describe('Property 10: Migration conserves population', () => {
  it('holds in every quarter of every accepted run', () => {
    // **Validates: Requirements 9.4, 9.5, 9.8**
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.constantFrom('real-style' as const, 'synthetic' as const).chain((eventMode) =>
          arbEngineInputs({ eventMode }),
        ),
        (inputs) => {
          const { policies, events, params, baseline, realTrack, commute, target } = inputs;
          const result = run(policies, events, params, baseline, realTrack, commute, target as QuarterKey);
          if (!result.ok) {
            expect([
              'households-exceed-renters',
              'stock-negative',
              'budget-exceeded',
              'ceiling-exceeded',
            ]).toContain(result.error.code);
            return;
          }
          accepted++;
          const bad: string[] = [];
          result.states.forEach((s, i) => bad.push(...violations(s, baseline, i)));
          expect(bad.slice(0, 5)).toEqual([]);
        },
      ),
      { numRuns: 100, endOnFailure: true },
    );
    expect(accepted).toBeGreaterThan(0);
  }, 120_000);
});
