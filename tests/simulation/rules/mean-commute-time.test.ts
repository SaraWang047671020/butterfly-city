// Example tests for the mean commute time indicator rule (task 7.5; Requirements 17.8, 2.5, 6.4).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { meanCommuteTimeRule } from '../../../src/simulation/rules/mean-commute-time.ts';
import { DISTRICT_CODES, buildParams, scalar } from '../fixtures/index.ts';
import { buildWork } from '../fixtures/work.ts';

const D = '63000010';

describe('mean commute time rule', () => {
  it('weights the matrix row by the job shares', () => {
    // Job shares 0.5 on the second and third district, 0 elsewhere.
    // Fixture matrix row 0: to index 1 is 10 + 1.5 x 1 = 11.5; to index 2 is 10 + 1.5 x 2 = 13.
    // Mean = 0.5 x 11.5 + 0.5 x 13 = 12.25 minutes.
    const overrides: Record<string, ReturnType<typeof scalar>> = {};
    DISTRICT_CODES.forEach((code, i) => {
      overrides[`commute.jobShare.${code}`] = scalar(i === 1 || i === 2 ? 0.5 : 0, { unit: 'share' });
    });
    const params = buildParams({ overrides });
    const work = buildWork({ params });
    const { value, breakdown } = finish(meanCommuteTimeRule.draft(D, work), {
      indicator: 'meanCommuteTime',
      district: D,
      quarter: work.quarter,
      params,
    });
    expect(value).toBeCloseTo(12.25, 9);
    expect(breakdown.causes.map((c) => c.id)).toEqual([
      'baseline',
      'socialHousing',
      'commuterPass',
      'rentSubsidy',
      'sublease',
      'holdingTax',
      'migration',
      'bound',
    ]);
    // Every tool Cause is 0 in this spec.
    expect(breakdown.causes.slice(1, 6).map((c) => c.contribution)).toEqual([0, 0, 0, 0, 0]);
    expect(breakdown.causes[0]?.parameterIds).toHaveLength(41);
  });

  it('is 0 when the job share sits on the district itself (zero diagonal)', () => {
    const overrides: Record<string, ReturnType<typeof scalar>> = {};
    DISTRICT_CODES.forEach((code, i) => {
      overrides[`commute.jobShare.${code}`] = scalar(i === 0 ? 1 : 0, { unit: 'share' });
    });
    const params = buildParams({ overrides });
    const work = buildWork({ params });
    const { value } = finish(meanCommuteTimeRule.draft(D, work), {
      indicator: 'meanCommuteTime',
      district: D,
      quarter: work.quarter,
      params,
    });
    expect(value).toBe(0);
  });
});
