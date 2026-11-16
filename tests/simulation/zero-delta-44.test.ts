// 44-quarter zero-delta example test (task 13.1, Requirements 3.1 and 3.8).
// A fixed synthetic 44-quarter Baseline and a Player_Policy_Timeline equal to the Real_Policy_Track.

import { describe, expect, it } from 'vitest';
import { run } from '../../src/simulation/engine.ts';
import { derivedMeanCommuteTime, derivedRentBurden } from '../../src/simulation/derived.ts';
import { derivedGhostCount } from '../../src/simulation/ghosts.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';
import {
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  buildRealTrack,
  DISTRICT_CODES,
} from './fixtures/index.ts';

// householdIncome is an input of the Derived_Baseline, not an Output_Indicator.
const BASELINE_INDICATORS = ['population', 'rent', 'mrtEntries', 'socialHousingStock'];

describe('44-quarter zero-delta run', () => {
  const baseline = buildBaseline({ quarters: 44 });
  const realTrack = buildRealTrack({ quarters: 44 });
  const params = buildParams();
  const commute = buildCommuteMatrix();
  const result = run(realTrack, [], params, baseline, realTrack, commute, '2025Q4');

  it('returns 44 Sim_States from 2015Q1 to 2025Q4 and no error', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.states).toHaveLength(44);
    result.states.forEach((s, q) => expect(s.quarter).toBe(quarterAt(q)));
    expect(result.states[43]?.quarter).toBe('2025Q4');
  });

  it('reproduces every Baseline value with ===', () => {
    if (!result.ok) throw new Error('run failed');
    for (const id of BASELINE_INDICATORS) {
      for (const code of DISTRICT_CODES) {
        const series = baseline.indicators[id]?.[code] ?? [];
        result.states.forEach((s, q) => {
          const expected = series[q];
          if (typeof expected !== 'number') return;
          expect(s.values[id]?.[code] === expected).toBe(true);
        });
      }
    }
  });

  it('reproduces every Derived_Baseline value with ===', () => {
    if (!result.ok) throw new Error('run failed');
    for (const code of DISTRICT_CODES) {
      result.states.forEach((s, q) => {
        const burden = derivedRentBurden(baseline, params, code, q);
        const time = derivedMeanCommuteTime(params, commute, code, s.quarter);
        if (!burden.ok || !time.ok) throw new Error('derived input invalid');
        expect(s.values['rentBurden']?.[code] === burden.value).toBe(true);
        expect(s.values['meanCommuteTime']?.[code] === time.value).toBe(true);
        const pop = baseline.indicators['population']?.[code]?.[q] ?? Number.NaN;
        const ghosts = derivedGhostCount(params, pop, time.value);
        expect(s.values['ghostCount']?.[code] === ghosts).toBe(true);
      });
    }
  });

  it('has only zero non-Baseline Causes and a Baseline Cause equal to the value', () => {
    if (!result.ok) throw new Error('run failed');
    for (const s of result.states) {
      for (const [id, byDistrict] of Object.entries(s.causes)) {
        for (const code of DISTRICT_CODES) {
          const breakdown = byDistrict[code];
          expect(breakdown).toBeDefined();
          if (breakdown === undefined) continue;
          const value = s.values[id]?.[code];
          for (const cause of breakdown.causes) {
            if (cause.kind === 'baseline') {
              expect(cause.contribution === value).toBe(true);
            } else {
              expect(cause.contribution === 0).toBe(true);
            }
          }
        }
      }
    }
  });

  it('holds only zero Policy_Differences in every Lag_Pipeline', () => {
    if (!result.ok) throw new Error('run failed');
    for (const s of result.states) {
      for (const entry of s.lagPipeline) {
        for (const v of Object.values(entry)) {
          if (typeof v === 'number') expect(v === 0).toBe(true);
        }
      }
    }
  });
});
