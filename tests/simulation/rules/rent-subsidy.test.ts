// Example tests for the rent subsidy rule (task 4.4; Requirements 17.8, 6.4, 6.6, 6.9, 6.14).
// Renter rate 0.4, household size 2.5, P = 100,000: Hr = 16,000. Income 720,000: m = 60,000. S = 30.
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { rentSubsidyRule } from '../../../src/simulation/rules/rent-subsidy.ts';
import type { RuleContext, ToolSetting } from '../../../src/types/simulation.ts';
import { buildBaseline, buildCommuteMatrix, buildParams, buildRealTrack } from '../fixtures/index.ts';

const D0 = '63000010';
const D1 = '63000020';

function context(population: (i: number) => number = () => 100_000): RuleContext {
  return {
    params: buildParams(), // passThrough 0.5
    baseline: buildBaseline({
      population,
      householdIncome: () => 720_000,
      rent: () => 600,
    }),
    realTrack: buildRealTrack(),
    commute: buildCommuteMatrix(),
  };
}

function setting(taipeiHouseholds: number, taipeiAmount = 0): ToolSetting {
  return {
    households: { Taipei: taipeiHouseholds, 'New Taipei': 5_000 },
    amount: { Taipei: taipeiAmount, 'New Taipei': 0 },
  };
}

describe('rent subsidy rule', () => {
  it('gives direct -0.5 pp, rent +5, follow-on +0.25 pp, net -0.25 pp for a = 4,800,000', () => {
    const ctx = context();
    // 12 equal Taipei districts: a_d = 57,600,000 / 12 = 4,800,000
    const out = rentSubsidyRule.effects({ Taipei: 57_600_000, 'New Taipei': 0 }, '2018Q1', ctx);
    // direct = -4.8e6 / (16,000 x 60,000) x 100 = -0.5; rent = 0.5 x 4.8e6 / (16,000 x 30) = 5
    // follow-on = 0.5 x 0.5 = 0.25; net = -0.25 (the burden falls)
    expect(out.deltas['rent']?.[D0]).toBeCloseTo(5, 9);
    expect(out.deltas['rentBurden']?.[D0]).toBeCloseTo(-0.25, 9);
    // Ghost group in totals form: -(1 - 0.5) x 4.8e6 / 60,000 x 100 x 2.5 = -10,000
    expect(out.ghostGroups?.[D0]?.[0]?.source).toBe('subsidy');
    expect(out.ghostGroups?.[D0]?.[0]?.personPp).toBeCloseTo(-10_000, 6);
  });

  it('allocates the city amount by renter share', () => {
    // District 0 has twice the population: Hr = 32,000 against 16,000 for the other 11.
    const ctx = context((i) => (i === 0 ? 200_000 : 100_000));
    // Taipei renters = 208,000. Delta 1.248e9: direct = -1.248e9 / (208,000 x 60,000) x 100 = -10 pp
    // in every district of the city (a_d is proportional to Hr_d). Rent: 0.5 x a_d / (Hr_d x 30).
    const out = rentSubsidyRule.effects({ Taipei: 1_248_000_000, 'New Taipei': 0 }, '2018Q1', ctx);
    // rent = 0.5 x 1.248e9 / (208,000 x 30) = 100; net burden = -10 + 5 = -5
    expect(out.deltas['rentBurden']?.[D0]).toBeCloseTo(-5, 9);
    expect(out.deltas['rentBurden']?.[D1]).toBeCloseTo(-5, 9);
    expect(out.deltas['rent']?.[D0]).toBeCloseTo(100, 9);
    expect(out.deltas['rent']?.[D1]).toBeCloseTo(100, 9);
    expect(out.deltas['rent']?.['65000010']).toBe(0);
  });

  it('computes the difference as player total minus real total', () => {
    const real = setting(5_000, 4_800_000);
    const player = setting(6_000, 5_000_000);
    const d = rentSubsidyRule.difference(player, real, '2018Q1', context());
    expect(d['Taipei']).toBe(6_000 * 5_000_000 - 5_000 * 4_800_000);
    expect(d['New Taipei']).toBe(0);
  });

  it('allocates only among districts with renters when one district has 0 renters (6.3, 6.11)', () => {
    // District 0 has population 0, so Hr = 0. The other 11 Taipei districts have Hr = 16,000 each.
    const ctx = context((i) => (i === 0 ? 0 : 100_000));
    // Taipei renters = 176,000. Delta 1.056e9: share = 1/11, a_d = 96,000,000 for each of the 11.
    const out = rentSubsidyRule.effects({ Taipei: 1_056_000_000, 'New Taipei': 0 }, '2018Q1', ctx);
    // direct = -96e6 / (16,000 x 60,000) x 100 = -10 pp; rent = 0.5 x 96e6 / (16,000 x 30) = 100;
    // follow-on = 0.5 x 10 = 5; net = -5. Allocations: 11 x 96e6 = 1.056e9 (the city difference).
    expect(out.deltas['rent']?.[D1]).toBeCloseTo(100, 9);
    expect(out.deltas['rentBurden']?.[D1]).toBeCloseTo(-5, 9);
    expect(out.deltas['rent']?.[D0]).toBe(0);
    expect(out.deltas['rentBurden']?.[D0]).toBe(0);
    expect(Object.is(out.deltas['rent']?.[D0], 0)).toBe(true);
    expect(Object.is(out.deltas['rentBurden']?.[D0], 0)).toBe(true);
    expect(out.ghostGroups?.[D0]?.[0]?.personPp).toBe(0);
    expect(out.ghostGroups?.[D0]?.[0]?.persons).toBe(0);
    // A valid setting with a non-zero city difference raises no error: other districts have renters.
    const real = setting(0, 0);
    expect(rentSubsidyRule.checkSetting(setting(10, 100), real, '2018Q1', ctx)).toBeNull();
  });

  it('gives zero deltas to a zero-renter district when the city difference is 0', () => {
    const ctx = context((i) => (i < 12 ? 0 : 100_000));
    const out = rentSubsidyRule.effects({ Taipei: 0, 'New Taipei': 0 }, '2018Q1', ctx);
    for (const v of Object.values(out.deltas['rent'] ?? {})) expect(Object.is(v, 0)).toBe(true);
    for (const v of Object.values(out.deltas['rentBurden'] ?? {})) expect(Object.is(v, 0)).toBe(true);
    const real = setting(0, 0);
    expect(rentSubsidyRule.checkSetting(real, real, '2018Q1', ctx)).toBeNull();
  });

  it('returns derived-input-invalid for a non-zero city difference when no district has renters', () => {
    const ctx = context((i) => (i < 12 ? 0 : 100_000));
    const error = rentSubsidyRule.checkSetting(setting(10, 100), setting(0, 0), '2018Q1', ctx);
    expect(error?.code).toBe('derived-input-invalid');
    expect(error?.details).toMatchObject({ id: 'renterHouseholds', quarter: '2018Q1' });
  });

  it('rejects households above the renter households of a city', () => {
    const ctx = context();
    const real = setting(5_000);
    expect(rentSubsidyRule.checkSetting(setting(192_000), real, '2018Q1', ctx)).toBeNull();
    const error = rentSubsidyRule.checkSetting(setting(192_001), real, '2018Q1', ctx);
    expect(error?.code).toBe('households-exceed-renters');
    expect(error?.details).toMatchObject({
      where: 'rent-subsidy',
      city: 'Taipei',
      quarter: '2018Q1',
      households: 192_001,
    });
    expect(error?.details['renters']).toBeCloseTo(192_000, 6);
  });
});
