import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scenarioTable } from '../../../src/simulation/params.ts';
import type { ParameterTable } from '../../../src/types/simulation.ts';
import { arbParams } from '../arbitraries.ts';
import { buildParams } from '../fixtures/index.ts';

const VARYING = [
  'migration.commuteCostPerMinute',
  'socialHousing.rentPerUnit',
  'socialHousing.rentRatio',
  'commuterPass.elasticity',
  'rentSubsidy.passThrough',
  'ghost.commuteThreshold',
  'ghost.shareCommuteWithin',
] as const;

// Direction: the migration cost per minute is strongest at range.high; the other six at range.low.
const HIGH_IS_STRONGEST = 'migration.commuteCostPerMinute';

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
          const strongestHigh = id === HIGH_IS_STRONGEST;
          const lowEnd = strongestHigh ? before.range.high : before.range.low;
          const highEnd = strongestHigh ? before.range.low : before.range.high;
          expect(after.value).toBe(scenario === 'low' ? lowEnd : highEnd);
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
  it('Property 23: only the seven ranged effect parameters vary between scenarios', () => {
    fc.assert(
      fc.property(arbParams(), (params) => {
        checkTable(params);
      }),
      { numRuns: 100 },
    );
  });

  it('moves the seven effect parameters of the fixture table by direction', () => {
    const params = buildParams();
    const low = scenarioTable(params, 'low');
    const high = scenarioTable(params, 'high');
    for (const id of VARYING) {
      const p = params[id];
      if (p?.kind !== 'scalar' || p.range === undefined) continue;
      const l = low[id];
      const h = high[id];
      const flip = id === HIGH_IS_STRONGEST;
      expect(l?.kind === 'scalar' ? l.value : undefined).toBe(flip ? p.range.high : p.range.low);
      expect(h?.kind === 'scalar' ? h.value : undefined).toBe(flip ? p.range.low : p.range.high);
    }
    checkTable(params);
  });

  it('gives the migration cost its high end in the low Scenario and 0 in the high Scenario', () => {
    const params = buildParams();
    const id = 'migration.commuteCostPerMinute';
    const p = params[id];
    expect(p?.kind === 'scalar' ? p.range?.low : undefined).toBe(0);
    const low = scenarioTable(params, 'low');
    const high = scenarioTable(params, 'high');
    const value = (t: ParameterTable): number | undefined => {
      const e = t[id];
      return e?.kind === 'scalar' ? e.value : undefined;
    };
    expect(value(low)).toBe(p?.kind === 'scalar' ? p.range?.high : NaN);
    expect(value(high)).toBe(0);
    for (const other of VARYING.filter((v) => v !== id)) {
      const q = params[other];
      if (q?.kind !== 'scalar' || q.range === undefined) continue;
      const l = low[other];
      const h = high[other];
      expect(l?.kind === 'scalar' ? l.value : undefined).toBe(q.range.low);
      expect(h?.kind === 'scalar' ? h.value : undefined).toBe(q.range.high);
    }
  });
});
