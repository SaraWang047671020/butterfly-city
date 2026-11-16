import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scenarioTable } from '../../../src/simulation/params.ts';
import type { ParameterTable } from '../../../src/types/simulation.ts';
import { arbParams } from '../arbitraries.ts';
import { buildParams } from '../fixtures/index.ts';

const VARYING = [
  'socialHousing.rentPerUnit',
  'socialHousing.rentRatio',
  'commuterPass.elasticity',
  'rentSubsidy.passThrough',
  'ghost.commuteThreshold',
  'ghost.shareCommuteWithin',
] as const;

const FIXED_NAMED = [
  'socialHousing.unitCost',
  'ghost.sensitivityRent',
  'ghost.rentThreshold',
  'ghost.atRiskThreshold',
] as const;

function checkTable(params: ParameterTable): void {
  const snapshot = JSON.stringify(params);
  for (const scenario of ['central', 'low', 'high'] as const) {
    const out = scenarioTable(params, scenario);
    expect(Object.keys(out).sort()).toEqual(Object.keys(params).sort());
    for (const id of Object.keys(params)) {
      const before = params[id];
      const after = out[id];
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      if (before === undefined || after === undefined) continue;
      const varies = (VARYING as readonly string[]).includes(id);
      if (varies && scenario !== 'central' && before.kind === 'scalar' && before.range !== undefined) {
        expect(after.kind).toBe('scalar');
        if (after.kind === 'scalar') {
          expect(after.value).toBe(scenario === 'low' ? before.range.low : before.range.high);
        }
      } else {
        expect(after).toEqual(before);
      }
    }
    for (const id of FIXED_NAMED) {
      expect(out[id]).toEqual(params[id]);
    }
  }
  // The input table is never changed.
  expect(JSON.stringify(params)).toBe(snapshot);
}

describe('scenario tables', () => {
  // Feature: simulation-engine, Property 23: Scenario tables vary only ranged effect parameters
  // **Validates: Requirements 7.1, 19.2, 19.5, 4.12**
  it('Property 23: only the six ranged effect parameters vary between scenarios', () => {
    fc.assert(
      fc.property(arbParams(), (params) => {
        checkTable(params);
      }),
      { numRuns: 100 },
    );
  });

  it('moves the six effect parameters of the fixture table to low and high', () => {
    const params = buildParams();
    const low = scenarioTable(params, 'low');
    const high = scenarioTable(params, 'high');
    for (const id of VARYING) {
      const p = params[id];
      if (p?.kind !== 'scalar' || p.range === undefined) continue;
      const l = low[id];
      const h = high[id];
      expect(l?.kind === 'scalar' ? l.value : undefined).toBe(p.range.low);
      expect(h?.kind === 'scalar' ? h.value : undefined).toBe(p.range.high);
    }
    checkTable(params);
  });
});
