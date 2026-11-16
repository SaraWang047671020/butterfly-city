import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { ParameterTable } from '../../../src/types/simulation.ts';
import { run } from '../../../src/simulation/engine.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

const LAG_ID = 'socialHousing.lag';

function withLag(params: ParameterTable, value: number): ParameterTable | null {
  const lag = params[LAG_ID];
  if (lag === undefined || lag.kind !== 'scalar') return null;
  return { ...params, [LAG_ID]: { ...lag, value } };
}

function runWith(inputs: EngineInputs, params: ParameterTable) {
  return run(
    inputs.policies,
    inputs.events,
    params,
    inputs.baseline,
    inputs.realTrack,
    inputs.commute,
    inputs.target as QuarterKey,
  );
}

const arbValidLag = fc.oneof(
  fc.integer({ min: 0, max: 43 }),
  fc.integer({ min: 12, max: 20 }),
  fc.constantFrom(0, 12, 20, 43),
);

const arbInvalidLag = fc.oneof(
  fc.integer({ min: -1000, max: -1 }),
  fc.integer({ min: 44, max: 1000 }),
  fc.constantFrom(-1, 44),
  fc
    .double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true })
    .filter((x) => !Number.isInteger(x)),
);

describe('Property 25: Social housing Lag accepts the whole 0-43 range', () => {
  // Feature: simulation-engine, Property 25: Social housing Lag accepts the whole 0–43 range
  // **Validates: Requirements 7.2, 7.8, 17.12**
  it('integer Lags 0 to 43 with the NLMA note give no parameters-invalid error', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 1 }), arbValidLag, (inputs, lag) => {
        const params = withLag(inputs.params, lag);
        if (params === null) return false;
        const result = runWith(inputs, params);
        if (result.ok) return true;
        // Other generated inputs may fail for unrelated reasons, never for the Lag.
        if (result.error.code !== 'parameters-invalid') return true;
        return false;
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('integers outside 0 to 43 and non-integers return parameters-invalid naming socialHousing.lag', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 1 }), arbInvalidLag, (inputs, lag) => {
        const params = withLag(inputs.params, lag);
        if (params === null) return false;
        const result = runWith(inputs, params);
        if (result.ok) return false;
        if (result.error.code !== 'parameters-invalid') return false;
        return (result.error.issues ?? []).some((i) => i.parameterId === LAG_ID);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('treats a Lag of 12 and a Lag of 20 like 11 and 21', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 1 }), (inputs) => {
        return [11, 12, 20, 21].every((lag) => {
          const params = withLag(inputs.params, lag);
          if (params === null) return false;
          const result = runWith(inputs, params);
          return result.ok || result.error.code !== 'parameters-invalid';
        });
      }),
      { numRuns: 30, endOnFailure: true },
    );
  }, 120_000);
});
