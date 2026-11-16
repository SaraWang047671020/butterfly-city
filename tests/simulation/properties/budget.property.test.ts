import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { BudgetLedger, EngineError } from '../../../src/types/simulation.ts';
import { checkBudget } from '../../../src/simulation/budget.ts';
import { run, step } from '../../../src/simulation/engine.ts';
import { quarterAt, quarterYear } from '../../../src/simulation/quarter.ts';
import { RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import { arbEngineInputs } from '../arbitraries.ts';

const FIRST_YEAR = 2015;
const BUDGET_CODES: readonly string[] = ['budget-exceeded', 'ceiling-exceeded'];
// Other valid rejections of generated inputs (not budget related); they leave the budget claim untested.
const OTHER_VALID_CODES: readonly string[] = ['households-exceed-renters', 'limit-exceeded', 'stock-negative'];

function yearSum(slots: readonly number[], y: number): number {
  let sum = 0;
  for (let s = y * 4; s < y * 4 + 4; s += 1) sum += slots[s] ?? 0;
  return sum;
}

/** Every committed year stays within the Annual_Budget and each tool within its ceiling; all values are integers. */
function expectLedgerWithinBudget(ledger: BudgetLedger): void {
  const ids = Object.keys(ledger.committed);
  const years = ledger.plan.annualBudget.length;
  for (let y = 0; y < years; y += 1) {
    let total = 0;
    for (const id of ids) {
      const slots = ledger.committed[id] ?? [];
      for (const amount of slots) expect(Number.isInteger(amount)).toBe(true);
      const spent = yearSum(slots, y);
      total += spent;
      expect(spent).toBeLessThanOrEqual(ledger.plan.ceilings[id]?.[y] ?? 0);
    }
    expect(total).toBeLessThanOrEqual(ledger.plan.annualBudget[y] ?? 0);
  }
}

function num(error: EngineError, key: string): number {
  const v = error.details[key];
  return typeof v === 'number' ? v : Number.NaN;
}

describe('Property 4: Budget never overspent', () => {
  // **Validates: Requirements 8.4, 8.5, 8.6, 8.10, 8.11, 18.6**
  it('run is accepted within every budget and ceiling or rejected with a budget code; checkBudget equals the step decision', () => {
    let accepted = 0;
    let budgetRejected = 0;
    const tools = RULE_REGISTRY.tools;

    fc.assert(
      fc.property(arbEngineInputs(), (inputs) => {
        const { policies, events, params, baseline, realTrack, commute } = inputs;
        const target = inputs.target as QuarterKey;
        const result = run(policies, events, params, baseline, realTrack, commute, target);

        if (result.ok) {
          accepted += 1;
          for (const state of result.states) expectLedgerWithinBudget(state.ledger);
        } else if (BUDGET_CODES.includes(result.error.code)) {
          budgetRejected += 1;
        } else {
          expect(OTHER_VALID_CODES).toContain(result.error.code);
        }

        // checkBudget against the step decision, quarter by quarter from the first state.
        const first = run(policies, events, params, baseline, realTrack, commute, quarterAt(0));
        if (!first.ok) return;
        let state = first.states[0];
        if (state === undefined) return;
        const quarters = baseline.quarters.length;
        for (let k = 1; k < quarters; k += 1) {
          const proposed = policies.find((s) => s.quarter === quarterAt(k));
          if (proposed === undefined) return;
          const stepped = step(state, policies, events, params, baseline, realTrack, commute);
          const checked = checkBudget(proposed, state.ledger, params, tools);
          if (stepped.ok) {
            expect(checked.ok).toBe(true);
            if (!checked.ok) return;
            const year = quarterYear(quarterAt(k));
            const y = year - FIRST_YEAR;
            const ledger = stepped.state.ledger;
            expect(checked.year).toBe(year);
            expect(checked.annualBudget).toBe(ledger.plan.annualBudget[y] ?? 0);
            expect(checked.remaining).toBe(ledger.remaining);
            expect(checked.committed).toBe(checked.annualBudget - ledger.remaining);
            state = stepped.state;
          } else if (stepped.error.code === 'budget-exceeded') {
            expect(checked.ok).toBe(false);
            if (checked.ok || checked.reason !== 'annual-budget') {
              expect(checked).toMatchObject({ reason: 'annual-budget' });
              return;
            }
            expect(checked.year).toBe(num(stepped.error, 'year'));
            expect(checked.annualBudget).toBe(num(stepped.error, 'annualBudget'));
            expect(checked.committed).toBe(num(stepped.error, 'committed'));
            expect(checked.over).toBe(num(stepped.error, 'over'));
            return;
          } else if (stepped.error.code === 'ceiling-exceeded') {
            expect(checked.ok).toBe(false);
            if (checked.ok || checked.reason !== 'tool-ceiling') {
              expect(checked).toMatchObject({ reason: 'tool-ceiling' });
              return;
            }
            expect(checked.tool).toBe(String(stepped.error.details['tool']));
            expect(checked.year).toBe(num(stepped.error, 'year'));
            expect(checked.ceiling).toBe(num(stepped.error, 'ceiling'));
            expect(checked.committed).toBe(num(stepped.error, 'committed'));
            expect(checked.over).toBe(num(stepped.error, 'over'));
            return;
          } else {
            // A non-budget rejection says nothing about the budget decision.
            return;
          }
        }
      }),
      { numRuns: 100 },
    );

    expect(accepted).toBeGreaterThanOrEqual(20);
    expect(accepted + budgetRejected).toBeGreaterThan(0);
  }, 120_000);
});
