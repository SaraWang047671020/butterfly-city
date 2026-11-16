import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { run } from '../../../src/simulation/engine.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { arbEngineInputs } from '../arbitraries.ts';

describe('Property 1: Zero-delta identity', () => {
  it('reproduces the Baseline exactly when the player timeline equals the Real_Policy_Track', () => {
    // **Validates: Requirements 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 8.9, 13.10**
    fc.assert(
      fc.property(
        arbEngineInputs({ playerMode: 'equal-to-real', eventMode: 'real-style' }),
        (inp) => {
          const result = run(
            inp.realTrack,
            inp.events,
            inp.params,
            inp.baseline,
            inp.realTrack,
            inp.commute,
            inp.target as QuarterKey,
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const { states } = result;
          expect(states).toHaveLength(inp.baseline.quarters.length);

          states.forEach((state, q) => {
            expect(state.quarter).toBe(quarterAt(q));
            for (const ind of state.indicators) {
              const series = inp.baseline.indicators[ind.id];
              for (const [code, value] of Object.entries(state.values[ind.id] ?? {})) {
                const base = series?.[code]?.[q];
                if (typeof base === 'number') expect(value).toBe(base);
                const breakdown = state.causes[ind.id]?.[code];
                expect(breakdown).toBeDefined();
                if (breakdown === undefined) continue;
                expect(breakdown.value).toBe(value);
                for (const cause of breakdown.causes) {
                  if (cause.kind === 'baseline') expect(cause.contribution).toBe(value);
                  else expect(cause.contribution).toBe(0);
                }
              }
            }
            for (const entry of state.lagPipeline) expect(entry.value).toBe(0);
          });

          // Spending: complete years of the last state equal the real charges and the Annual_Budget.
          const last = states[states.length - 1];
          if (last === undefined) return;
          const plan = last.ledger.plan;
          const n = states.length;
          for (let year = 0; year < Math.floor(n / 4); year++) {
            let total = 0;
            for (const [tool, committed] of Object.entries(last.ledger.committed)) {
              let real = 0;
              let spent = 0;
              for (let s = year * 4; s < year * 4 + 4; s++) {
                spent += committed[s] ?? 0;
                for (let q = 0; q < n; q++) real += plan.realCharges[tool]?.[q]?.[s] ?? 0;
              }
              expect(spent).toBeCloseTo(real, 4);
              total += spent;
            }
            const budget = plan.annualBudget[year] ?? 0;
            expect(Math.abs(total - budget)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(budget)));
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
