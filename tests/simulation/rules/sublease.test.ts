// Example tests for the sublease rule (housing-tools Requirement 4; task 4).
// Renter rate 0.4, household size 2.5, P = 100,000: Hr = 16,000. Income 720,000: m = 60,000. S = 30 m2.
// Rent 600 TWD per m2 per month, rentShare 0.85: a matched home saves 0.15 x 600 x 30 = 2,700 TWD per month.
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { subleaseRule } from '../../../src/simulation/rules/sublease.ts';
import type { RuleContext, ToolSetting } from '../../../src/types/simulation.ts';
import { buildBaseline, buildCommuteMatrix, buildParams, buildRealTrack } from '../fixtures/index.ts';

const D0 = '63000010';
const NT0 = '65000010';

function context(population: (i: number) => number = () => 100_000): RuleContext {
  return {
    params: buildParams(), // rentShare 0.85, unitCost 160,000, lag 1
    baseline: buildBaseline({ population, householdIncome: () => 720_000, rent: () => 600 }),
    realTrack: buildRealTrack(),
    commute: buildCommuteMatrix(),
  };
}

function setting(taipei: number, newTaipei = 100): ToolSetting {
  return { unitsMatched: { Taipei: taipei, 'New Taipei': newTaipei } };
}

describe('sublease rule', () => {
  it('lowers the rent burden by the rent saved in the extra homes', () => {
    // 1,920 extra Taipei homes over 12 equal districts: 160 each, saving 160 x 2,700 = 432,000 TWD per month.
    const out = subleaseRule.effects({ Taipei: 1_920, 'New Taipei': 0 }, '2018Q1', context());
    // burden = -432,000 / (16,000 x 60,000) x 100 = -0.045 pp
    expect(out.deltas['rentBurden']?.[D0]).toBeCloseTo(-0.045, 12);
    expect(out.deltas['rentBurden']?.[NT0]).toBe(0);
    // The programme sets the rent: no market rent delta.
    expect(out.deltas['rent']).toBeUndefined();
    // Ghost group: 160 homes x 2.5 persons = 400 persons, each -2,700 / 60,000 x 100 = -4.5 pp; totals -1,800.
    const g = out.ghostGroups?.[D0]?.[0];
    expect(g?.source).toBe('sublease');
    expect(g?.persons).toBeCloseTo(400, 9);
    expect(g?.burdenChangePp).toBeCloseTo(-4.5, 9);
    expect(g?.personPp).toBeCloseTo(-1_800, 9);
  });

  it('raises the burden of the households not housed when fewer homes are matched', () => {
    const out = subleaseRule.effects({ Taipei: -1_920, 'New Taipei': 0 }, '2018Q1', context());
    expect(out.deltas['rentBurden']?.[D0]).toBeCloseTo(0.045, 12);
    const g = out.ghostGroups?.[D0]?.[0];
    expect(g?.persons).toBeCloseTo(400, 9);
    expect(g?.personPp).toBeCloseTo(1_800, 9);
  });

  it('gives exactly 0 everywhere at a zero difference', () => {
    const out = subleaseRule.effects({ Taipei: 0, 'New Taipei': 0 }, '2018Q1', context());
    for (const v of Object.values(out.deltas['rentBurden'] ?? {})) expect(Object.is(v, 0)).toBe(true);
    for (const list of Object.values(out.ghostGroups ?? {})) expect(list[0]?.personPp).toBe(0);
  });

  it('computes the difference and the charge per home matched', () => {
    const ctx = context();
    const real = setting(100);
    const player = setting(150);
    expect(subleaseRule.difference(player, real, '2018Q1', ctx)).toEqual({ Taipei: 50, 'New Taipei': 0 });
    // 50 x 160,000 = 8,000,000; real (100 + 100) x 160,000 = 32,000,000
    expect(subleaseRule.charge(player, real, '2018Q1', ctx)).toEqual({ real: 32_000_000, difference: 8_000_000 });
  });

  it('rejects a negative or fractional value and accepts a large one (the budget decides)', () => {
    const ctx = context();
    const real = setting(100);
    expect(subleaseRule.checkSetting(setting(-1), real, '2018Q1', ctx)?.code).toBe('policy-value-invalid');
    expect(subleaseRule.checkSetting(setting(1.5), real, '2018Q1', ctx)?.code).toBe('policy-value-invalid');
    expect(subleaseRule.checkSetting(setting(1_000_000), real, '2018Q1', ctx)).toBeNull();
  });

  it('is a city-level stock tool with a lag, a rent share and a cost schedule', () => {
    expect(subleaseRule.level).toBe('city');
    expect(subleaseRule.effect).toBe('stock');
    expect(subleaseRule.lagParameterId).toBe('sublease.lag');
    const ids = subleaseRule.parameters().map((p) => p.id);
    expect(ids).toContain('sublease.costSchedule');
    expect(ids).toContain('sublease.rentShare');
  });
});
