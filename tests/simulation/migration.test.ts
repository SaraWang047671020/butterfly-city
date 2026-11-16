// Example test for the Migration_Rule (task 6.5; Requirements 17.8, 9.1, 9.2, 9.3, 9.4, 5.5).
// One origin A with three destinations B, C, D. Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { migrate, type MigrationDistrict } from '../../src/simulation/migration.ts';
import type { CommuteMatrix } from '../../src/types/simulation.ts';
import { buildParams, scalar } from './fixtures/index.ts';

const LN2 = Math.LN2;

// Minutes from A to B, C, D are 1, 2, 3. Rows of B, C and D are never used (they do not migrate).
const COMMUTE: CommuteMatrix = {
  codes: ['A', 'B', 'C', 'D'],
  minutes: [
    [0, 1, 2, 3],
    [1, 0, 1, 2],
    [2, 1, 0, 1],
    [3, 2, 1, 0],
  ],
};

function districts(originExcess: number, originOffset?: number): MigrationDistrict[] {
  const origin: MigrationDistrict = {
    code: 'A',
    population: 1000,
    rentBurden: 30 + originExcess,
    baselineRentBurden: 30,
    ...(originOffset === undefined ? {} : { commuteCostOffset: originOffset }),
  };
  const others = ['B', 'C', 'D'].map(
    (code): MigrationDistrict => ({ code, population: 1000, rentBurden: 30, baselineRentBurden: 30 }),
  );
  return [origin, ...others];
}

// threshold 5 pp, share 0.1, exitShare 0.1: out = floor(0.1 x 1000) = 100, exits = floor(0.1 x 100) = 10,
// 90 persons are split among B, C, D. The burden weight is 0 so destination burden does not matter.
function params(weightTime: number, weightCost: number) {
  return buildParams({
    overrides: {
      'migration.threshold': scalar(5),
      'migration.share': scalar(0.1),
      'migration.exitShare': scalar(0.1),
      'migration.weightTime': scalar(weightTime),
      'migration.weightBurden': scalar(0),
      'migration.weightCost': scalar(weightCost),
      'migration.commuteCostPerMinute': scalar(10),
    },
  });
}

describe('Migration_Rule example', () => {
  it('moves out floor(share x P) from an origin above the threshold and counts the exits', () => {
    const r = migrate(districts(6), COMMUTE, params(LN2, 0));
    expect(r.out).toEqual({ A: 100, B: 0, C: 0, D: 0 });
    expect(r.displaced).toEqual(r.out);
    expect(r.exits).toBe(10);
  });

  it('allocates the 90 staying persons by largest remainder in the ratio 4 : 2 : 1', () => {
    // weights exp(-ln2 x minutes) relative to the largest: 1, 1/2, 1/4 -> 4/7, 2/7, 1/7 of 90
    // exact 51.43, 25.71, 12.86; floors 51, 25, 12; the 2 left go to D (.86) and C (.71)
    const r = migrate(districts(6), COMMUTE, params(LN2, 0));
    expect(r.in).toEqual({ A: 0, B: 51, C: 26, D: 13 });
    expect(r.net).toEqual({ A: -100, B: 51, C: 26, D: 13 });
  });

  it('conserves people: total net equals minus the exits', () => {
    const r = migrate(districts(6), COMMUTE, params(LN2, 0));
    const totalNet = Object.values(r.net).reduce((a, b) => a + b, 0);
    expect(totalNet).toBe(-r.exits);
    const totalIn = Object.values(r.in).reduce((a, b) => a + b, 0);
    expect(totalIn).toBe(90);
  });

  it('weights the destinations equally when time, burden and cost weights are 0', () => {
    const r = migrate(districts(6), COMMUTE, params(0, 0));
    expect(r.in).toEqual({ A: 0, B: 30, C: 30, D: 30 });
  });

  it('changes the allocation through the commute cost term', () => {
    // weightCost = ln2 / 10, cost = 10 x minutes: the exponent is -ln2 x minutes, same as the time case
    const withCost = migrate(districts(6), COMMUTE, params(0, LN2 / 10));
    expect(withCost.in).toEqual({ A: 0, B: 51, C: 26, D: 13 });
    expect(withCost.in).not.toEqual(migrate(districts(6), COMMUTE, params(0, 0)).in);
  });

  it('subtracts the origin commute-cost offset K_o and floors the cost at 0', () => {
    // K_o = 25: costs max(0, 10 - 25), max(0, 20 - 25), 30 - 25 = 0, 0, 5; exponents 0, 0, -ln2 / 2
    // weights 1, 1, 0.7071 -> exact 33.25, 33.25, 23.51; floors 33, 33, 23; the 1 left goes to D (.51)
    const r = migrate(districts(6, 25), COMMUTE, params(0, LN2 / 10));
    expect(r.in).toEqual({ A: 0, B: 33, C: 33, D: 24 });
  });

  it('does not migrate when the burden excess equals the threshold', () => {
    const r = migrate(districts(5), COMMUTE, params(LN2, 0));
    expect(r.in).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(r.out).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(r.net).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(r.exits).toBe(0);
  });

  it('migrates just above the threshold', () => {
    const r = migrate(districts(5.01), COMMUTE, params(LN2, 0));
    expect(r.out.A).toBe(100);
  });
});
