// Example tests for the rent indicator rule (task 7.5; Requirements 17.8, 2.5, 4.7).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { rentRule } from '../../../src/simulation/rules/rent.ts';
import { buildBaseline, buildParams } from '../fixtures/index.ts';
import { buildWork, effectOf, eventCause, toolEffects } from '../fixtures/work.ts';

const D = '63000010';

function run(
  baselineRent: number,
  delta: number,
  eventValue?: number,
) {
  const work = buildWork({
    baseline: buildBaseline({ rent: () => baselineRent }),
    effects: toolEffects({ socialHousing: effectOf('rent', D, delta) }),
    eventContributions:
      eventValue === undefined
        ? {}
        : { socialHousing: { rent: { [D]: [eventCause('evt.rate', eventValue)] } } },
  });
  return finish(rentRule.draft(D, work), {
    indicator: 'rent',
    district: D,
    quarter: work.quarter,
    params: buildParams(),
  });
}

describe('rent rule', () => {
  it('adds the tool delta to the Baseline rent', () => {
    const { value, breakdown } = run(600, -0.2);
    expect(value).toBeCloseTo(599.8, 9);
    expect(breakdown.causes[1]?.id).toBe('socialHousing');
    expect(breakdown.causes[1]?.contribution).toBeCloseTo(-0.2, 9);
  });

  it('limits a negative rent to 0 and records the limit in the Bound_Adjustment', () => {
    const { value, breakdown } = run(600, -700);
    expect(value).toBe(0);
    expect(breakdown.causes.at(-1)?.id).toBe('bound');
    expect(breakdown.causes.at(-1)?.contribution).toBe(100);
  });

  it('splits an Event modifier from the tool Cause so the two sum to the delta', () => {
    // Modified delta -5 with an Event Cause of -1: the tool Cause keeps -4.
    const { value, breakdown } = run(600, -5, -1);
    expect(value).toBe(595);
    expect(breakdown.causes.map((c) => c.id)).toEqual([
      'baseline',
      'socialHousing',
      'commuterPass',
      'rentSubsidy',
      'evt.rate',
      'migration',
      'bound',
    ]);
    expect(breakdown.causes[1]?.contribution).toBe(-4);
    expect(breakdown.causes[4]?.contribution).toBe(-1);
  });

  it('declares kind non-negative and stage pre-migration', () => {
    expect(rentRule.valueKind).toBe('non-negative');
    expect(rentRule.stage).toBe('pre-migration');
  });
});
