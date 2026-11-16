import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/simulation/engine.ts';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { SimState } from '../../../src/types/simulation.ts';
import { arbEngineInputs } from '../arbitraries.ts';

/** Returns a description of every violation (plain loops: millions of numbers per run). */
function violations(state: SimState): string[] {
  const bad: string[] = [];
  const finite = (v: number, where: string) => {
    if (!Number.isFinite(v)) bad.push(`not finite: ${where} = ${v}`);
  };

  for (const ind of state.indicators) {
    const byDistrict = state.values[ind.id];
    if (byDistrict === undefined) {
      bad.push(`no values for ${ind.id}`);
      continue;
    }
    for (const [code, v] of Object.entries(byDistrict)) {
      const where = `${ind.id} ${code} ${state.quarter}`;
      finite(v, where);
      if (ind.kind === 'count' && !Number.isInteger(v)) bad.push(`count not an integer: ${where} = ${v}`);
      if ((ind.kind === 'count' || ind.kind === 'non-negative') && v < 0) bad.push(`negative: ${where} = ${v}`);
      const breakdown = state.causes[ind.id]?.[code];
      if (breakdown === undefined) {
        bad.push(`no breakdown: ${where}`);
        continue;
      }
      finite(breakdown.value, `breakdown value ${where}`);
      for (const cause of breakdown.causes) finite(cause.contribution, `cause ${cause.id} ${where}`);
    }
  }

  const { ledger, migration } = state;
  finite(ledger.remaining, 'ledger.remaining');
  for (const [tool, slots] of Object.entries(ledger.committed)) {
    slots.forEach((v, i) => finite(v, `ledger.committed ${tool}[${i}]`));
  }
  ledger.plan.annualBudget.forEach((v, i) => finite(v, `annualBudget[${i}]`));
  for (const [tool, years] of Object.entries(ledger.plan.ceilings)) {
    years.forEach((v, i) => finite(v, `ceilings ${tool}[${i}]`));
  }
  for (const [tool, quarters] of Object.entries(ledger.plan.realCharges)) {
    quarters.forEach((slots, q) => slots.forEach((v, i) => finite(v, `realCharges ${tool}[${q}][${i}]`)));
  }
  for (const e of state.lagPipeline) finite(e.value, `lag entry ${e.tool} ${e.area}`);
  for (const [code, v] of Object.entries(migration.displaced)) finite(v, `displaced ${code}`);
  for (const [code, v] of Object.entries(migration.movedIn)) finite(v, `movedIn ${code}`);
  finite(migration.exits, 'migration.exits');
  return bad;
}

describe('Property 7: Counts are non-negative integers and all numbers are finite', () => {
  it('holds for every accepted run', () => {
    // **Validates: Requirements 10.3, 12.2, 12.6, 12.8, 12.9, 13.9**
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
            // Generated rent subsidy households can exceed the renters of a tiny district, fewer started
            // units than the real track can push a small Baseline stock below 0 (Requirement 4.9), and
            // generated player timelines are not always budget neutral (Requirements 8.6, 18.6).
            expect([
              'households-exceed-renters',
              'stock-negative',
              'budget-exceeded',
              'ceiling-exceeded',
            ]).toContain(result.error.code);
            return;
          }
          accepted++;
          const bad = result.states.flatMap(violations);
          expect(bad.slice(0, 5)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
    expect(accepted).toBeGreaterThan(0);
  }, 120_000);
});
