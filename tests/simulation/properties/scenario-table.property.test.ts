import { isDeepStrictEqual } from 'node:util';
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
  'sublease.rentShare',
  'holdingTax.vacancyEffect',
  'holdingTax.passThrough',
  'ghost.commuteThreshold',
  'ghost.shareCommuteWithin',
] as const;

// Direction: the migration cost per minute is strongest at range.high; the other nine at range.low.
const HIGH_IS_STRONGEST = 'migration.commuteCostPerMinute';

const FIXED_NAMED = [
  'socialHousing.unitCost',
  'ghost.sensitivityRent',
  'ghost.rentThreshold',
  'ghost.atRiskThreshold',
] as const;

// Plain loops collect mismatches and assert once, because per-field expect() calls dominate the run time.
function checkTable(params: ParameterTable): void {
  const snapshot = JSON.stringify(params);
  const mismatches: string[] = [];
  for (const scenario of ['central', 'low', 'high'] as const) {
    const out = scenarioTable(params, scenario);
    const inKeys = Object.keys(params).sort();
    if (!isDeepStrictEqual(Object.keys(out).sort(), inKeys)) {
      mismatches.push(`${scenario}: key set differs`);
      continue;
    }
    for (const id of inKeys) {
      const before = params[id];
      const after = out[id];
      if (before === undefined || after === undefined) {
        mismatches.push(`${scenario}: ${id} missing`);
        continue;
      }
      const varies = (VARYING as readonly string[]).includes(id);
      if (varies && scenario !== 'central' && before.kind === 'scalar' && before.range !== undefined) {
        const strongestHigh = id === HIGH_IS_STRONGEST;
        const lowEnd = strongestHigh ? before.range.high : before.range.low;
        const highEnd = strongestHigh ? before.range.low : before.range.high;
        const want = scenario === 'low' ? lowEnd : highEnd;
        if (after.kind !== 'scalar' || !Object.is(after.value, want)) {
          mismatches.push(`${scenario}: ${id} expected ${want}`);
        }
      } else if (!isDeepStrictEqual(after, before)) {
        mismatches.push(`${scenario}: ${id} changed`);
      }
    }
    for (const id of FIXED_NAMED) {
      if (!isDeepStrictEqual(out[id], params[id])) mismatches.push(`${scenario}: ${id} not fixed`);
    }
  }
  // The input table is never changed.
  if (JSON.stringify(params) !== snapshot) mismatches.push('input table was mutated');
  expect(mismatches).toEqual([]);
}

describe('scenario tables', () => {
  // Feature: simulation-engine, Property 23: Scenario tables vary only ranged effect parameters
  // **Validates: Requirements 7.1, 19.2, 19.5, 4.12**
  it('Property 23: only the ten ranged effect parameters vary between scenarios', () => {
    fc.assert(
      fc.property(arbParams(), (params) => {
        checkTable(params);
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  it('moves the ten effect parameters of the fixture table by direction', () => {
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
