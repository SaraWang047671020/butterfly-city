// Example tests for the population indicator rule (task 7.5; Requirements 17.8, 9.5, 9.8, 2.5).
// Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { finish } from '../../../src/simulation/explain.ts';
import { populationRule } from '../../../src/simulation/rules/population.ts';
import { buildBaseline, buildParams } from '../fixtures/index.ts';
import { buildWork } from '../fixtures/work.ts';

const D = '63000010';

function run(migration: ReturnType<typeof buildWork>['migration']) {
  const work = buildWork({
    baseline: buildBaseline({ population: () => 100_000 }),
    migration,
  });
  return finish(populationRule.draft(D, work), {
    indicator: 'population',
    district: D,
    quarter: work.quarter,
    params: buildParams(),
  });
}

describe('population rule', () => {
  it('migration Cause equals persons moved in minus persons moved out', () => {
    // In 400, out 150: net 250. Value 100,000 + 250.
    const { value, breakdown } = run({
      net: { [D]: 400 - 150 },
      displaced: { [D]: 150 },
      movedIn: { [D]: 400 },
      exits: 0,
    });
    expect(value).toBe(100_250);
    const migration = breakdown.causes.find((c) => c.kind === 'migration');
    expect(migration?.contribution).toBe(250);
    expect(migration?.parameterIds).toContain('migration.share');
  });

  it('equals the Baseline population when migration has not run', () => {
    const { value, breakdown } = run(null);
    expect(value).toBe(100_000);
    expect(breakdown.causes.find((c) => c.kind === 'migration')?.contribution).toBe(0);
  });

  it('subtracts a net outflow', () => {
    expect(
      run({ net: { [D]: -75 }, displaced: { [D]: 75 }, movedIn: { [D]: 0 }, exits: 0 }).value,
    ).toBe(99_925);
  });

  it('declares kind count and stage post-migration', () => {
    expect(populationRule.valueKind).toBe('count');
    expect(populationRule.stage).toBe('post-migration');
  });
});
