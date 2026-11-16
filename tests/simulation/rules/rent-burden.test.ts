// Example tests for the rent burden indicator rule (task 7.5; Requirements 17.8, 2.5, 4.15, 6.4).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { rentBurdenRule } from '../../../src/simulation/rules/rent-burden.ts';
import { buildBaseline, buildParams } from '../fixtures/index.ts';
import { buildWork, effectOf, eventCause, toolEffects } from '../fixtures/work.ts';

const D = '63000010';

// Dwelling size 30 m2, income 720,000 per year: monthly 60,000, k = 30 / 60,000 x 100 = 0.05.
function run(rent: number, delta = 0, eventValue?: number) {
  const work = buildWork({
    baseline: buildBaseline({ rent: () => rent, householdIncome: () => 720_000 }),
    effects: toolEffects({ rentSubsidy: effectOf('rentBurden', D, delta) }),
    eventContributions:
      eventValue === undefined
        ? {}
        : { rentSubsidy: { rentBurden: { [D]: [eventCause('evt.rate', eventValue)] } } },
  });
  return finish(rentBurdenRule.draft(D, work), {
    indicator: 'rentBurden',
    district: D,
    quarter: work.quarter,
    params: buildParams(),
  });
}

describe('rent burden rule', () => {
  it('derives the start value from rent, dwelling size and income', () => {
    // 600 x 0.05 = 30 percent.
    const { value, breakdown } = run(600);
    expect(value).toBeCloseTo(30, 9);
    expect(breakdown.causes[0]?.parameterIds).toEqual(['housing.dwellingSize']);
    expect(breakdown.causes[0]?.sourceIds).toEqual(['src.householdIncome', 'src.rent']);
  });

  it('adds the tool delta under its own tool Cause', () => {
    const { value, breakdown } = run(600, -5);
    expect(value).toBeCloseTo(25, 9);
    expect(breakdown.causes[3]?.id).toBe('rentSubsidy');
    expect(breakdown.causes[3]?.contribution).toBe(-5);
  });

  it('clamps the derived start value to 100', () => {
    // 3000 x 0.05 = 150, clamped to 100 by the Derived_Baseline.
    expect(run(3000).value).toBe(100);
  });

  it('clamps the sum to 100 with a Bound_Adjustment', () => {
    // 30 + 80 = 110, limited to 100.
    const { value, breakdown } = run(600, 80);
    expect(value).toBe(100);
    expect(breakdown.causes.at(-1)?.contribution).toBeCloseTo(-10, 9);
  });

  it('keeps the tool Cause without the Event modifier', () => {
    // Modified delta -5 with an Event Cause of -1: tool Cause -4.
    const { breakdown } = run(600, -5, -1);
    expect(breakdown.causes.find((c) => c.id === 'rentSubsidy')?.contribution).toBe(-4);
    expect(breakdown.causes.find((c) => c.id === 'evt.rate')?.contribution).toBe(-1);
  });
});
