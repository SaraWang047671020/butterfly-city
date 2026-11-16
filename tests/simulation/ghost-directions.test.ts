// Hand-worked Ghost direction example tests (task 13.4; Requirements 4.15, 4.16, 4.18, 6.4, 6.14, 10.6, 17.8, 17.14).
// Central Scenario, one district, Lag 0 (the matured differences are given directly), no migration.
// Expected values are hand-computed literals.
//
// Shared inputs: P = 100,000; household size 2.5 (H = 40,000); renter rate 0.4 (Hr = 16,000); rent 600;
// S = 30; income 720,000 (m = 60,000, k = 30 / 60,000 x 100 = 0.05); Derived_Baseline burden 30 percent;
// shareCommuteWithin 0.8 (bC = 0.2), shareBoth 0.04, sensitivityRent 0.01, G = 1,000, rentRatio 0.8,
// rentPerUnit 0, passThrough 0.5.
//
// shareRent is 0.1 (the spec value). The zero-delta sum is exactly 26,000 and 1 - 0.8 is
// 0.19999999999999996 in floating point; the Ghost floor tolerance (GHOST_FLOOR_TOLERANCE) keeps the count at 26.
// R0 = 10,000; C0 = 100,000 x 0.2 = 20,000; O0 = 100,000 x 0.04 = 4,000;
// zero-delta count = floor(26,000 / 1000) = 26.

import { describe, expect, it } from 'vitest';
import { finish } from '../../src/simulation/explain.ts';
import { derivedGhostCount } from '../../src/simulation/ghosts.ts';
import { ghostCountRule, ghostCountValue } from '../../src/simulation/rules/ghost-count.ts';
import { rentBurdenRule } from '../../src/simulation/rules/rent-burden.ts';
import { rentSubsidyRule } from '../../src/simulation/rules/rent-subsidy.ts';
import { socialHousingRule } from '../../src/simulation/rules/social-housing.ts';
import type {
  CommuteMatrix,
  GhostGroupContribution,
  QuarterWork,
  ToolEffects,
} from '../../src/types/simulation.ts';
import { buildBaseline, buildParams, scalar } from './fixtures/index.ts';
import { buildWork } from './fixtures/work.ts';

const D = '63000010';
const QUARTER = '2015Q1' as const;

const params = buildParams({
  overrides: {
    'ghost.shareRent': scalar(0.1, { unit: 'share' }),
    'ghost.shareCommuteWithin': scalar(0.8, { unit: 'share' }),
    'ghost.shareBoth': scalar(0.04, { unit: 'share' }),
    'ghost.sensitivityRent': scalar(0.01, { unit: 'share per percentage point' }),
    [`commute.jobShare.${D}`]: scalar(1, { unit: 'share' }),
  },
});

const baseline = {
  ...buildBaseline({
    quarters: 1,
    population: () => 100_000,
    householdIncome: () => 720_000,
    rent: () => 600,
  }),
  districts: [{ code: D, city: 'Taipei' as const }],
};

const commute: CommuteMatrix = { codes: [D], minutes: [[0]] };

interface Matured {
  /** Matured social housing stock difference X in the district. */
  readonly units?: number;
  /** Matured rent subsidy difference a in Taipei, TWD per month. */
  readonly amount?: number;
}

function scenario(matured: Matured): {
  readonly work: QuarterWork;
  readonly social: ToolEffects;
  readonly subsidy: ToolEffects;
} {
  const base = buildWork({ params, baseline, values: { population: { [D]: 100_000 } } });
  const ctx = { ...base.ctx, commute };
  const social = socialHousingRule.effects({ [D]: matured.units ?? 0 }, QUARTER, ctx);
  const subsidy = rentSubsidyRule.effects(
    { Taipei: matured.amount ?? 0, 'New Taipei': 0 },
    QUARTER,
    ctx,
  );
  const commuterPass: ToolEffects = { deltas: {}, links: {} };
  return {
    work: { ...base, ctx, effects: { socialHousing: social, commuterPass, rentSubsidy: subsidy } },
    social,
    subsidy,
  };
}

function ghost(work: QuarterWork) {
  return finish(ghostCountRule.draft(D, work), {
    indicator: 'ghostCount',
    district: D,
    quarter: work.quarter,
    params: work.ctx.params,
    valueOverride: ghostCountValue(D, work),
  });
}

function burden(work: QuarterWork) {
  return finish(rentBurdenRule.draft(D, work), {
    indicator: 'rentBurden',
    district: D,
    quarter: work.quarter,
    params: work.ctx.params,
  });
}

function group(effects: ToolEffects, source: GhostGroupContribution['source']): GhostGroupContribution {
  const found = effects.ghostGroups?.[D]?.find((g) => g.source === source);
  if (found === undefined) throw new Error(`missing ${source} group`);
  return found;
}

function cause(breakdown: ReturnType<typeof ghost>['breakdown'], id: string): number {
  const c = breakdown.causes.find((x) => x.id === id);
  if (c === undefined) throw new Error(`missing cause ${id}`);
  return c.contribution;
}

describe('Ghost direction, hand-worked central Scenario', () => {
  it('gives the zero-delta Ghost count 26 and the Derived_Baseline burden 30 percent', () => {
    const { work } = scenario({});
    expect(derivedGhostCount(params, 100_000, 0)).toBe(26);
    const g = ghost(work);
    expect(g.value).toBe(26);
    expect(burden(work).value).toBeCloseTo(30, 9);
  });

  it('(a) +200 social housing units lower the Ghost count to 25', () => {
    const { work, social } = scenario({ units: 200 });

    // Housed: 200 x 2.5 = 500 persons; per-household change (0.8 x 600 - 600) x 0.05 = -6 pp; personPp -3,000.
    const housed = group(social, 'housed');
    expect(housed.persons).toBeCloseTo(500, 9);
    expect(housed.burdenChangePp).toBeCloseTo(-6, 9);
    expect(housed.personPp).toBeCloseTo(-3000, 9);
    expect(30 + housed.burdenChangePp).toBeCloseTo(24, 9);
    expect(group(social, 'spillover').personPp).toBe(0);

    // District burden: 30 + 200 x (-6) / 16,000 = 29.925.
    expect(burden(work).value).toBeCloseTo(29.925, 9);

    // R = 10,000 - 30 = 9,970; sO = 0.04 + (0.0997 - 0.1) x 0.2 = 0.03994; O = 3,994.
    // Count = floor((9,970 + 20,000 - 3,994) / 1000) = floor(25.976) = 25.
    const { value, breakdown } = ghost(work);
    expect(value).toBe(25);
    expect(value).toBeLessThan(26);
    expect(cause(breakdown, 'ghost-rent-housed')).toBeCloseTo(-0.03, 9);
    expect(cause(breakdown, 'ghost-rent-spillover')).toBe(0);
    expect(cause(breakdown, 'ghost-overlap')).toBeCloseTo(0.006, 9);
    // Bound_Adjustment = 25 - (26 - 0.03 + 0 + 0.006) = -0.976.
    expect(cause(breakdown, 'bound')).toBeCloseTo(-0.976, 9);
  });

  it('(b) a rent subsidy of 4,800,000 with renter rate 0.4 lowers the burden and does not raise the Ghost count', () => {
    const { work, subsidy } = scenario({ amount: 4_800_000 });

    // Direct -4,800,000 / (16,000 x 60,000) x 100 = -0.5 pp; rent +0.5 x 4,800,000 / (16,000 x 30) = +5;
    // follow-on +0.5 x 4,800,000 / (16,000 x 60,000) x 100 = +0.25; net -0.25 pp.
    expect(subsidy.deltas['rent']?.[D]).toBeCloseTo(5, 9);
    expect(subsidy.deltas['rentBurden']?.[D]).toBeCloseTo(-0.25, 9);
    expect(burden(work).value).toBeCloseTo(29.75, 9);

    // personPp = -(1 - 0.5) x 4,800,000 / 60,000 x 100 x 2.5 = -10,000.
    expect(group(subsidy, 'subsidy').personPp).toBeCloseTo(-10_000, 6);

    // R = 10,000 - 100 = 9,900; sO = 0.04 + (0.099 - 0.1) x 0.2 = 0.0398; O = 3,980.
    // Count = floor((9,900 + 20,000 - 3,980) / 1000) = floor(25.92) = 25.
    const { value } = ghost(work);
    expect(value).toBe(25);
    expect(value).toBeLessThanOrEqual(26);
  });

  it('(c) -200 social housing units do not lower the Ghost count', () => {
    const { work, social } = scenario({ units: -200 });
    expect(group(social, 'housed').personPp).toBeCloseTo(3000, 9);

    // R = 10,000 + 30 = 10,030; sO = 0.04 + (0.1003 - 0.1) x 0.2 = 0.04006; O = 4,006.
    // Count = floor((10,030 + 20,000 - 4,006) / 1000) = floor(26.024) = 26.
    const { value } = ghost(work);
    expect(value).toBe(26);
    expect(value).toBeGreaterThanOrEqual(26);
  });
});
