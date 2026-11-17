// Example tests for the social housing rule (task 4.4; Requirements 17.8, 4.6, 4.15, 4.17).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { commit, mature } from '../../../src/simulation/lag.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { checkRenterCapacity, socialHousingRule } from '../../../src/simulation/rules/social-housing.ts';
import type { RuleContext } from '../../../src/types/simulation.ts';
import {
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  buildRealTrack,
  scalar,
} from '../fixtures/index.ts';

const TAIPEI = '63000010';

function context(rentPerUnit: number): RuleContext {
  return {
    params: buildParams({
      overrides: { 'socialHousing.rentPerUnit': scalar(rentPerUnit, { unit: 'TWD per m2 per unit' }) },
    }),
    // P = 100,000, household size 2.5, renter rate 0.4: Hr = 16,000. Income 720,000: m = 60,000.
    baseline: buildBaseline({
      population: () => 100_000,
      householdIncome: () => 720_000,
      rent: () => 600,
    }),
    realTrack: buildRealTrack(),
    commute: buildCommuteMatrix(),
  };
}

describe('social housing rule', () => {
  it('delivers +100 units after a Lag of 12 quarters with rent spillover -0.2', () => {
    const ctx = context(-0.002);
    const committed = quarterAt(0);
    const effect = quarterAt(12);
    expect(effect).toBe('2018Q1');

    const pipeline = commit([], [{ tool: 'socialHousing', area: TAIPEI, committed, effect, value: 100 }]);
    expect(mature(pipeline, '2017Q4').matured).toHaveLength(0);
    const m = mature(pipeline, '2018Q1');
    expect(m.matured).toHaveLength(1);
    expect(m.rest).toHaveLength(0);

    const before = socialHousingRule.effects({ [TAIPEI]: 0 }, '2017Q4', ctx);
    expect(before.deltas['socialHousingStock']?.[TAIPEI]).toBe(0);
    expect(before.deltas['rent']?.[TAIPEI]).toBe(0);

    const after = socialHousingRule.effects({ [TAIPEI]: 100 }, '2018Q1', ctx);
    expect(after.deltas['socialHousingStock']?.[TAIPEI]).toBe(100);
    expect(after.deltas['rent']?.[TAIPEI]).toBeCloseTo(-0.2, 9);
  });

  it('computes the direct burden path for X = 200 (rho 0.8, rent 600, S 30)', () => {
    const ctx = context(0);
    const out = socialHousingRule.effects({ [TAIPEI]: 200 }, '2018Q1', ctx);
    // k = 30 / 60,000 x 100 = 0.05. Housed burden 0.8 x 600 x 0.05 = 24 percent.
    // Per household: (480 - 600) x 0.05 = -6 pp. District: 200 x -6 / 16,000 = -0.075 pp.
    expect(out.deltas['rentBurden']?.[TAIPEI]).toBeCloseTo(-0.075, 9);
    expect(out.deltas['rent']?.[TAIPEI]).toBe(0);

    const groups = out.ghostGroups?.[TAIPEI] ?? [];
    const housed = groups.find((g) => g.source === 'housed');
    const spill = groups.find((g) => g.source === 'spillover');
    expect(housed?.persons).toBeCloseTo(500, 9);
    expect(housed?.burdenChangePp).toBeCloseTo(-6, 9);
    expect(housed?.personPp).toBeCloseTo(-3000, 9);
    expect(spill?.personPp).toBe(0);
  });

  it('has exactly zero effects at a zero difference', () => {
    const out = socialHousingRule.effects({}, '2018Q1', context(-0.002));
    for (const id of ['socialHousingStock', 'rent', 'rentBurden']) {
      expect(out.deltas[id]?.[TAIPEI]).toBe(0);
    }
    const groups = out.ghostGroups?.[TAIPEI] ?? [];
    expect(groups.every((g) => g.personPp === 0)).toBe(true);
  });

  it('gives a finite zero direct term for a negative X in a district with 0 renter households', () => {
    // Population 0 gives Hr = 0. With rent-per-unit 0 there is no spillover, so the burden delta is exactly 0.
    const ctx: RuleContext = {
      ...context(0),
      baseline: buildBaseline({ population: () => 0, householdIncome: () => 720_000, rent: () => 600 }),
    };
    expect(checkRenterCapacity({ [TAIPEI]: -1 }, '2018Q1', ctx)).toBeNull();
    const out = socialHousingRule.effects({ [TAIPEI]: -1 }, '2018Q1', ctx);
    expect(out.deltas['socialHousingStock']?.[TAIPEI]).toBe(-1);
    expect(out.deltas['rentBurden']?.[TAIPEI]).toBe(0);
    // Hand-checked: without the rule the housed group would be -1 x household size persons with a
    // nonzero burden change ((0.8 - 1) x 600 x k); with 0 renter households all three fields are exactly 0.
    const housed = out.ghostGroups?.[TAIPEI]?.find((g) => g.source === 'housed');
    expect(Object.is(housed?.persons, 0)).toBe(true);
    expect(Object.is(housed?.burdenChangePp, 0)).toBe(true);
    expect(Object.is(housed?.personPp, 0)).toBe(true);
    const spillover = out.ghostGroups?.[TAIPEI]?.find((g) => g.source === 'spillover');
    expect(Object.is(spillover?.persons, 0)).toBe(true);
    expect(Object.is(spillover?.personPp, 0)).toBe(true);
  });

  it('rejects a stock difference above the renter households', () => {
    const ctx = context(0);
    expect(checkRenterCapacity({ [TAIPEI]: 16_000 }, '2018Q1', ctx)).toBeNull();
    const error = checkRenterCapacity({ [TAIPEI]: 16_001 }, '2018Q1', ctx);
    expect(error?.code).toBe('households-exceed-renters');
    expect(error?.details).toMatchObject({
      where: 'social-housing',
      district: TAIPEI,
      quarter: '2018Q1',
      households: 16_001,
    });
    expect(error?.details['renters']).toBeCloseTo(16_000, 6);
  });
});
