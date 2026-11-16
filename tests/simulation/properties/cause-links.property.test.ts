import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/simulation/engine.ts';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { CauseParameter, SimState } from '../../../src/types/simulation.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

// Codes the engine may legitimately return for generated inputs (budget, limit and stock rejections).
const LEGITIMATE_REJECTIONS: readonly string[] = [
  'households-exceed-renters',
  'limit-exceeded',
  'stock-negative',
  'budget-exceeded',
  'ceiling-exceeded',
];

/** First problem found in the Cause links of one state, or null. No per-value assertions: the hot loop only compares. */
function firstProblem(state: SimState, inputs: EngineInputs): string | null {
  const sourceIds = new Set(inputs.baseline.sourceIds);
  for (const ind of state.indicators) {
    const byDistrict = state.causes[ind.id] ?? {};
    for (const [code, bd] of Object.entries(byDistrict)) {
      for (const c of bd.causes) {
        if (c.kind === 'bound') continue;
        const where = `${ind.id} ${code} ${state.quarter} ${c.kind}:${c.id}`;
        if (c.parameterIds.length + c.sourceIds.length === 0) return `${where}: no links`;
        for (const id of c.sourceIds) {
          if (!sourceIds.has(id)) return `${where}: unknown source ${id}`;
        }
        if (c.parameters.length !== c.parameterIds.length) return `${where}: parameters/parameterIds length differ`;
        for (let i = 0; i < c.parameterIds.length; i += 1) {
          const id = c.parameterIds[i] as string;
          if (!Object.hasOwn(inputs.params, id)) return `${where}: unknown parameter ${id}`;
          const entry = inputs.params[id];
          const got: CauseParameter | undefined = c.parameters[i];
          if (entry === undefined || got === undefined) return `${where}: missing entry for ${id}`;
          if (got.parameterId !== id) return `${where}: parameters out of order at ${id}`;
          if (got.status !== entry.status) return `${where}: status of ${id}`;
          if (JSON.stringify(got.estimated) !== JSON.stringify(entry.estimated)) return `${where}: estimated of ${id}`;
          const range = entry.kind === 'scalar' ? entry.range : undefined;
          if (JSON.stringify(got.range) !== JSON.stringify(range)) return `${where}: range of ${id}`;
        }
      }
    }
  }
  return null;
}

describe('cause links', () => {
  // Feature: simulation-engine, Property 9: Every Cause links to known parameters and sources
  // **Validates: Requirements 5.8, 13.7, 14.8, 14.9, 14.11**
  it('Property 9: every non-bound Cause links known ids and carries the table metadata', () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.constantFrom<'real-style' | 'synthetic'>('real-style', 'synthetic').chain((eventMode) =>
          arbEngineInputs({ eventMode }),
        ),
        (inputs) => {
          const result = run(
            inputs.policies,
            inputs.events,
            inputs.params,
            inputs.baseline,
            inputs.realTrack,
            inputs.commute,
            inputs.target as QuarterKey,
          );
          if (!result.ok) {
            fc.pre(!LEGITIMATE_REJECTIONS.includes(result.error.code));
            throw new Error(`unexpected rejection ${result.error.code}: ${result.error.message}`);
          }
          accepted += 1;
          for (const state of result.states) {
            const problem = firstProblem(state, inputs);
            if (problem !== null) throw new Error(problem);
          }
        },
      ),
      { numRuns: 100, endOnFailure: true },
    );
    expect(accepted).toBeGreaterThan(0);
  }, 120_000);
});
