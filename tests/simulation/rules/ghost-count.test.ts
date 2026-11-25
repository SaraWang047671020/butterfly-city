// Example tests for the Ghost count indicator rule (task 7.5; Requirements 17.8, 17.12, 10.5, 10.8).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { scenarioTable } from '../../../src/simulation/params.ts';
import { ghostCountRule, ghostCountValue } from '../../../src/simulation/rules/ghost-count.ts';
import type { GhostGroupContribution, ParameterTable, QuarterWork } from '../../../src/types/simulation.ts';
import { buildBaseline, buildParams } from '../fixtures/index.ts';
import { NO_LINKS, buildWork, toolEffects } from '../fixtures/work.ts';

const D = '63000010';

// Fixture parameters: size 1000, shareRent 0.15, shareCommuteWithin 0.7 (so bC = 0.3), shareBoth 0.03,
// sensitivityRent 0.02. Population 100,000 with commute time at its Derived_Baseline value.
// R0 = 15,000; C0 = 30,000; O0 = 3,000; count = floor(42,000 / 1000) = 42.

function work(
  params: ParameterTable,
  population: number,
  groups: readonly GhostGroupContribution[] = [],
): QuarterWork {
  return buildWork({
    params,
    baseline: buildBaseline({ population: () => population }),
    values: { population: { [D]: population } },
    effects: toolEffects({
      socialHousing: {
        deltas: {},
        links: {},
        ghostGroups: { [D]: groups },
      },
    }),
  });
}

function run(w: QuarterWork) {
  return finish(ghostCountRule.draft(D, w), {
    indicator: 'ghostCount',
    district: D,
    quarter: w.quarter,
    params: w.ctx.params,
    valueOverride: ghostCountValue(D, w),
  });
}

const ZERO_GROUP: GhostGroupContribution = {
  source: 'housed',
  persons: 0,
  burdenChangePp: 0,
  personPp: 0,
  links: NO_LINKS,
};

describe('ghost count rule', () => {
  it('is 0 for a district with zero population', () => {
    const { value, breakdown } = run(work(buildParams(), 0));
    expect(value).toBe(0);
    expect(breakdown.causes.every((c) => c.contribution === 0)).toBe(true);
  });

  it('has Baseline, the seven group Causes in order and the Bound_Adjustment, all 0 at zero differences', () => {
    const { value, breakdown } = run(work(buildParams(), 100_000, [ZERO_GROUP]));
    expect(value).toBe(42);
    expect(breakdown.causes).toHaveLength(9);
    expect(breakdown.causes.map((c) => c.id)).toEqual([
      'baseline',
      'ghost-rent-housed',
      'ghost-rent-spillover',
      'ghost-rent-subsidy',
      'ghost-rent-sublease',
      'ghost-commute',
      'ghost-overlap',
      'ghost-displaced',
      'bound',
    ]);
    expect(breakdown.causes[0]?.contribution).toBe(42);
    expect(breakdown.causes.slice(1).map((c) => c.contribution)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('moves the rent-group and overlap Causes for a hand-worked rent difference', () => {
    // Housed group: personPp = -3000. R = 15,000 + 0.02 x -3000 = 14,940. sR = 0.1494.
    // sO = 0.03 + (0.1494 - 0.15) x 0.3 = 0.02982; O = 2,982; C = 30,000.
    // Count = floor((14,940 + 30,000 - 2,982) / 1000) = floor(41.958) = 41.
    const group: GhostGroupContribution = {
      source: 'housed',
      persons: 500,
      burdenChangePp: -6,
      personPp: -3000,
      links: NO_LINKS,
    };
    const { value, breakdown } = run(work(buildParams(), 100_000, [group]));
    expect(value).toBe(41);
    expect(breakdown.causes[1]?.contribution).toBeCloseTo(-0.06, 9);
    expect(breakdown.causes[6]?.contribution).toBeCloseTo(0.018, 9);
    // Bound_Adjustment = 41 - (42 - 0.06 + 0.018) = -0.958.
    expect(breakdown.causes.at(-1)?.contribution).toBeCloseTo(-0.958, 9);
  });

  it('counts displaced residents as D / Ghost_Size', () => {
    const w = buildWork({
      baseline: buildBaseline({ population: () => 100_000 }),
      values: { population: { [D]: 100_000 } },
      effects: toolEffects(),
      migration: { net: { [D]: -2000 }, displaced: { [D]: 2000 }, movedIn: { [D]: 0 }, exits: 0 },
    });
    const { value, breakdown } = run(w);
    expect(breakdown.causes[7]?.contribution).toBe(2);
    expect(value).toBe(44);
  });

  it('Requirement 17.12: the low Scenario (threshold 45) has at least the Ghost count of the high Scenario (threshold 60)', () => {
    // Population 100,500 keeps the sums away from a whole multiple of Ghost_Size, where 1 - 0.55 in
    // floating point would put the floor one below the exact value.
    // R = 15,075 and O = 3,015 in both.
    // Low: shareCommuteWithin 0.55, so bC = 0.45, C = 45,225; count = floor(57,285 / 1000) = 57.
    // High: shareCommuteWithin 0.7, so bC = 0.3, C = 30,150; count = floor(42,210 / 1000) = 42.
    const base = buildParams();
    const low = ghostCountValue(D, work(scenarioTable(base, 'low'), 100_500));
    const high = ghostCountValue(D, work(scenarioTable(base, 'high'), 100_500));
    expect(low).toBe(57);
    expect(high).toBe(42);
    expect(low).toBeGreaterThanOrEqual(high);
  });
});
