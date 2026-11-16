// Example tests for the MRT entries indicator rule (task 7.5; Requirements 17.8, 5.9, 2.5).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { mrtEntriesRule } from '../../../src/simulation/rules/mrt-entries.ts';
import { DISTRICT_CODES, buildParams } from '../fixtures/index.ts';
import { buildWork, effectOf, toolEffects } from '../fixtures/work.ts';

// Fixture Baseline: district index 0 has no station (0 entries); index 1 has 1,000,000 + 10,000 + 0 at quarter 0.
const NO_STATION = DISTRICT_CODES[0] ?? '';
const STATION = DISTRICT_CODES[1] ?? '';

function run(district: string, delta: number) {
  const work = buildWork({
    effects: toolEffects({ commuterPass: effectOf('mrtEntries', district, delta) }),
  });
  return finish(mrtEntriesRule.draft(district, work), {
    indicator: 'mrtEntries',
    district,
    quarter: work.quarter,
    params: buildParams(),
  });
}

describe('MRT entries rule', () => {
  it('is 0 in a district without a station when the delta is 0', () => {
    const { value, breakdown } = run(NO_STATION, 0);
    expect(value).toBe(0);
    expect(breakdown.causes[0]?.contribution).toBe(0);
  });

  it('adds the commuter pass delta to the Baseline entries', () => {
    const { value, breakdown } = run(STATION, -50_000);
    expect(value).toBe(960_000);
    expect(breakdown.causes[0]?.contribution).toBe(1_010_000);
    expect(breakdown.causes[2]?.id).toBe('commuterPass');
    expect(breakdown.causes[2]?.contribution).toBe(-50_000);
  });

  it('limits entries below 0 to 0 through the Bound_Adjustment', () => {
    const { value, breakdown } = run(STATION, -2_000_000);
    expect(value).toBe(0);
    expect(breakdown.causes.at(-1)?.contribution).toBe(990_000);
  });

  it('declares kind non-negative and stage pre-migration', () => {
    expect(mrtEntriesRule.valueKind).toBe('non-negative');
    expect(mrtEntriesRule.stage).toBe('pre-migration');
  });
});
