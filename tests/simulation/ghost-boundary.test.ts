// Ghost floor boundary example (Requirement 10.1, design "Ghosts").
// P = 100,000, shareRent 0.1, shareCommuteWithin 0.8, shareBoth 0.04, G = 1,000, zero differences.
// Exact arithmetic: R = 10,000; C = 100,000 x 0.2 = 20,000; O = 4,000; sum = 26,000; count = 26.
// In floating point 1 - 0.8 = 0.19999999999999996, so the raw quotient is a few ulps below 26 and a bare floor gives 25.

import { describe, expect, it } from 'vitest';
import { computeGhostValues, derivedGhostCount } from '../../src/simulation/ghosts.ts';
import { buildParams, scalar } from './fixtures/index.ts';

const params = buildParams({
  overrides: {
    'ghost.shareRent': scalar(0.1, { unit: 'share' }),
    'ghost.shareCommuteWithin': scalar(0.8, { unit: 'share' }),
    'ghost.shareBoth': scalar(0.04, { unit: 'share' }),
    'ghost.size': scalar(1000, { unit: 'persons' }),
  },
});

describe('Ghost floor tolerance', () => {
  it('counts an exact multiple of the Ghost size as that multiple', () => {
    expect(derivedGhostCount(params, 100_000, 0)).toBe(26);
  });

  it('gives the same count through computeGhostValues at zero differences', () => {
    const v = computeGhostValues(
      params,
      { population: 100_000, commuteTime: 0, displaced: 0, groups: [] },
      100_000,
      0,
    );
    expect(v.count).toBe(26);
  });

  it('does not round a genuine shortfall up', () => {
    // 25,999 persons in the sum: floor(25.999) = 25.
    const v = computeGhostValues(
      params,
      { population: 100_000, commuteTime: 0, displaced: -1, groups: [] },
      100_000,
      0,
    );
    expect(v.count).toBe(25);
  });
});
