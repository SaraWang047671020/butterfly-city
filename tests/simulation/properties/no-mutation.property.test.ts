import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { emptyLedger, checkBudget, checkLimit, planBudget } from '../../../src/simulation/budget.ts';
import { run, runRange, step } from '../../../src/simulation/engine.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import { applyDefect, arbDefect, arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

/** Calls every function under test with `inputs` and checks that no argument changed and nothing threw. */
function checkNoMutation(inputs: EngineInputs, ledgerSource: EngineInputs): void {
  const target = inputs.target as QuarterKey;
  const { policies, events, params, baseline, realTrack, commute } = inputs;
  const tools = RULE_REGISTRY.tools;

  // A state and a ledger come from the valid inputs, so `step`, `checkBudget` and `checkLimit`
  // also see damaged inputs next to a well-formed state and ledger.
  const first = run(
    ledgerSource.policies,
    ledgerSource.events,
    ledgerSource.params,
    ledgerSource.baseline,
    ledgerSource.realTrack,
    ledgerSource.commute,
    quarterAt(0),
  );
  // A valid input set can still be rejected (for example `households-exceed-renters`); skip those.
  fc.pre(first.ok);
  if (!first.ok) return;
  const state = first.states[0];
  if (state === undefined) return;
  const plan = planBudget(ledgerSource.realTrack, ledgerSource.params, tools);
  const ledger = emptyLedger(plan);
  const proposed = policies[0] ?? { quarter: quarterAt(0), tools: {} };

  const args = { state, policies, events, params, baseline, realTrack, commute, ledger, proposed, tools: [...tools].map((t) => t.id) };
  const before = structuredClone(args);

  expect(() => step(state, policies, events, params, baseline, realTrack, commute)).not.toThrow();
  expect(() => run(policies, events, params, baseline, realTrack, commute, target)).not.toThrow();
  expect(() => runRange(policies, events, params, baseline, realTrack, commute, target)).not.toThrow();
  expect(() => checkBudget(proposed, ledger, params, tools)).not.toThrow();
  expect(() => checkLimit('socialHousing', 'unitsStarted', baseline.districts[0]?.code ?? '', quarterAt(0), ledger, params, tools)).not.toThrow();
  expect(() => checkLimit('commuterPass', 'subsidy', 'Taipei', quarterAt(0), ledger, params, tools)).not.toThrow();
  expect(() => checkLimit('rentSubsidy', 'amount', 'New Taipei', quarterAt(0), ledger, params, tools)).not.toThrow();

  expect(args).toEqual(before);
}

describe('no input mutation', () => {
  // Feature: simulation-engine, Property 3: No input mutation
  // **Validates: Requirements 1.10**
  it('Property 3: valid inputs are deep-equal to a structuredClone after every call', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 2 }), (inputs) => {
        checkNoMutation(inputs, inputs);
      }),
      { numRuns: 100 },
    );
  }, 180_000);

  it('Property 3: inputs with one injected defect are not changed and no call throws', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 2 }), arbDefect(), (valid, defect) => {
        const { inputs } = applyDefect(valid, defect);
        checkNoMutation(inputs, valid);
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});
