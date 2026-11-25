// Example tests for the holding tax rule (housing-tools Requirement 5; task 5).
// Fixture: w = 0.5, 100,000 homes per city at 800,000 TWD, 60,000 low-use homes, vacancy effect −0.13,
// French share 0.06, flexibility 1, pass-through 0.15, dwelling 30 m², rent 600 TWD/m²/month (annual rent 216,000).
// Renter rate 0.4, household size 2.5, P = 100,000: Hr = 16,000 per district, 12 Taipei districts.

import { describe, expect, it } from 'vitest';
import { planBudget } from '../../../src/simulation/budget.ts';
import { holdingTaxRule, revenueChange, vacancyChange } from '../../../src/simulation/rules/holding-tax.ts';
import type { RuleContext, ToolSetting } from '../../../src/types/simulation.ts';
import { buildBaseline, buildCommuteMatrix, buildParams, buildRealTrack } from '../fixtures/index.ts';

const D0 = '63000010';
const NT0 = '65000010';

function context(): RuleContext {
  return {
    params: buildParams(),
    baseline: buildBaseline({ population: () => 100_000, householdIncome: () => 720_000, rent: () => 600 }),
    realTrack: buildRealTrack(),
    commute: buildCommuteMatrix(),
  };
}

const rates = (low: number, high: number): ToolSetting => ({
  lowestRate: { Taipei: low, 'New Taipei': 1.5 },
  highestRate: { Taipei: high, 'New Taipei': 3.6 },
});
const REAL = rates(1.5, 3.6);

describe('holding tax rule', () => {
  it('has a zero difference, charge and effect at the real rates', () => {
    const ctx = context();
    expect(holdingTaxRule.difference(REAL, REAL, '2018Q1', ctx)).toEqual({ Taipei: 0, 'New Taipei': 0 });
    expect(holdingTaxRule.charge(REAL, REAL, '2018Q1', ctx)).toEqual({ real: 0, difference: 0 });
    const out = holdingTaxRule.effects({ Taipei: 0, 'New Taipei': 0 }, '2018Q1', ctx);
    for (const v of Object.values(out.deltas['rent'] ?? {})) expect(Object.is(v, 0)).toBe(true);
  });

  it('weights the two tiers by the low-tier share', () => {
    // Δr = 0.5 × (2.5 − 1.5) + 0.5 × (4.6 − 3.6) = 1 percentage point
    expect(holdingTaxRule.difference(rates(2.5, 4.6), REAL, '2018Q1', context())['Taipei']).toBeCloseTo(1, 12);
    expect(holdingTaxRule.difference(rates(2.5, 3.6), REAL, '2018Q1', context())['Taipei']).toBeCloseTo(0.5, 12);
  });

  it('raises revenue by homes × assessed value × Δr, charged as a negative amount', () => {
    const ctx = context();
    // 100,000 × 800,000 × 1 % = 800,000,000 TWD a year; 200,000,000 a quarter
    expect(revenueChange(ctx, 'Taipei', 1)).toBeCloseTo(800_000_000, 3);
    expect(holdingTaxRule.charge(rates(2.5, 4.6), REAL, '2018Q1', ctx)).toEqual({ real: 0, difference: -200_000_000 });
    expect(holdingTaxRule.charge(rates(1.5, 2.6), REAL, '2018Q1', ctx).difference).toBe(100_000_000);
  });

  it('lowers vacancy by the French effect scaled to the Taiwanese tax change', () => {
    // shock = (1 % × 800,000) / (216,000 × 0.06) = 8,000 / 12,960 = 0.617284; −0.13 × 0.617284 = −0.080247
    expect(vacancyChange(context(), 'Taipei', '2018Q1', 1)).toBeCloseTo(60_000 * -0.0802469, 1);
  });

  it('lowers rent through released homes and raises it through the tax passed on', () => {
    const ctx = context();
    const out = holdingTaxRule.effects({ Taipei: 1, 'New Taipei': 0 }, '2018Q1', ctx);
    // released 4,814.8 homes over 192,000 renters: −1 × 0.025077 × 600 = −15.046 TWD/m²;
    // passed: 0.15 × 8,000 / 12 / 30 = 3.3333 TWD/m²; net −11.713
    const released = 60_000 * 0.13 * (8_000 / 12_960);
    const expected = -(released / 192_000) * 600 + (0.15 * 8_000) / 12 / 30;
    expect(out.deltas['rent']?.[D0]).toBeCloseTo(expected, 6);
    // burden = k × Δrent, k = 30 / 60,000 × 100 = 0.05
    expect(out.deltas['rentBurden']?.[D0]).toBeCloseTo(0.05 * expected, 9);
    expect(out.deltas['rent']?.[NT0]).toBe(0);
    expect(out.ghostGroups?.[D0]?.[0]?.source).toBe('spillover');
  });

  it('rejects a lowest tier rate above the highest', () => {
    const e = holdingTaxRule.checkSetting(rates(3.7, 3.6), REAL, '2018Q1', context());
    expect(e?.code).toBe('policy-value-invalid');
    expect(holdingTaxRule.checkSetting(rates(3.6, 3.6), REAL, '2018Q1', context())).toBeNull();
  });

  it('keeps the Annual_Budget unchanged on the real track (no real charge)', () => {
    const ctx = context();
    const withTax = planBudget(ctx.realTrack, ctx.params, [holdingTaxRule], ctx);
    expect(withTax.annualBudget.every((x) => x === 0)).toBe(true);
  });
});
