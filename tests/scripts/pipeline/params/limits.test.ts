// housing-tools Requirement 2: Documented_Limits by city and year.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { limitIds, limitSourceType } from '../../../../scripts/pipeline/params/limits.ts';

const params = JSON.parse(readFileSync('public/data/params.json', 'utf8')).parameters as Record<string, { value: number }>;
const track = JSON.parse(readFileSync('public/data/policy-track.json', 'utf8')) as {
  quarters: string[];
  policySeries: { id: string; series: Record<string, { value: number | null }[]> }[];
};

describe('Documented_Limits', () => {
  it('154 ids, 2 cities × 11 years × (3 fields + 4 holding-tax rate bounds), all in params.json', () => {
    expect(limitIds()).toHaveLength(154);
    for (const id of limitIds()) expect(params[id]?.value).toBeGreaterThan(0);
    expect(limitSourceType('limit.rentSubsidy.households.max.Taipei.2015')).toBe(2);
    expect(limitSourceType('limit.rentSubsidy.amount.max.Taipei.2015')).toBe(1);
    expect(limitSourceType('ghost.size')).toBeNull();
  });

  it('the allocation in force each year: 1st revision through 2021, 2nd revision from 2022', () => {
    expect(params['limit.socialHousing.unitsStarted.max.Taipei.2019']?.value).toBe(4250);
    expect(params['limit.socialHousing.unitsStarted.max.Taipei.2022']?.value).toBe(3250);
    expect(params['limit.socialHousing.unitsStarted.max.New Taipei.2021']?.value).toBe(5000);
    expect(params['limit.socialHousing.unitsStarted.max.New Taipei.2024']?.value).toBe(4125);
    expect(params['limit.rentSubsidy.amount.max.Taipei.2023']?.value).toBe(14400);
    expect(params['limit.rentSubsidy.amount.max.New Taipei.2016']?.value).toBe(4000);
  });

  it('every real rent subsidy value lies within its limit, so the real track stays feasible', () => {
    for (const [sid, base] of [
      ['rentSubsidyHouseholds', 'limit.rentSubsidy.households.max'],
      ['rentSubsidyAmountPerHousehold', 'limit.rentSubsidy.amount.max'],
    ] as const) {
      const series = track.policySeries.find((s) => s.id === sid)?.series ?? {};
      for (const [city, values] of Object.entries(series)) {
        values.forEach((e, i) => {
          const max = params[`${base}.${city}.${track.quarters[i]?.slice(0, 4)}`]?.value ?? 0;
          expect(e.value ?? 0).toBeLessThanOrEqual(max);
        });
      }
    }
  });
});
