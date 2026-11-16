// Example tests for the social housing stock indicator rule (task 7.5; Requirements 17.8, 2.5).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { socialHousingStockRule } from '../../../src/simulation/rules/social-housing-stock.ts';
import { buildBaseline, buildParams } from '../fixtures/index.ts';
import { buildWork, effectOf, toolEffects } from '../fixtures/work.ts';

const D = '63000010';

function run(baselineStock: number, delta: number) {
  const work = buildWork({
    baseline: buildBaseline({ socialHousingStock: () => baselineStock }),
    effects: toolEffects({ socialHousing: effectOf('socialHousingStock', D, delta) }),
  });
  return finish(socialHousingStockRule.draft(D, work), {
    indicator: 'socialHousingStock',
    district: D,
    quarter: work.quarter,
    params: buildParams(),
  });
}

describe('social housing stock rule', () => {
  it('adds the matured stock difference to the Baseline stock', () => {
    const { value, breakdown } = run(500, 100);
    expect(value).toBe(600);
    expect(breakdown.causes.map((c) => c.id)).toEqual([
      'baseline',
      'socialHousing',
      'commuterPass',
      'rentSubsidy',
      'migration',
      'bound',
    ]);
    expect(breakdown.causes.map((c) => c.contribution)).toEqual([500, 100, 0, 0, 0, 0]);
    expect(breakdown.causes[0]?.sourceIds).toEqual(['src.socialHousingStock']);
  });

  it('equals the Baseline stock at a zero difference', () => {
    expect(run(500, 0).value).toBe(500);
  });

  it('rounds a fractional stock to a whole number through the Bound_Adjustment', () => {
    const { value, breakdown } = run(500, 0.4);
    expect(value).toBe(500);
    expect(breakdown.causes.at(-1)?.contribution).toBeCloseTo(-0.4, 9);
  });

  it('declares kind count and stage pre-migration', () => {
    expect(socialHousingStockRule.valueKind).toBe('count');
    expect(socialHousingStockRule.stage).toBe('pre-migration');
  });
});
