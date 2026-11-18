import { describe, expect, it } from 'vitest';
import { assumptionsFor, scenarioOfMax, scenarioOfMin } from '../../src/game/core/range-sources.ts';
import { scenarioTable } from '../../src/simulation/params.ts';
import type { ParameterTable, ScalarParameter } from '../../src/types/simulation.ts';

const cite = (name: string) => ({ citation: `${name} citation`, url: `https://example.org/${name}` });

function ranged(low: number, central: number, high: number, name: string, url = true): ScalarParameter {
  return {
    kind: 'scalar',
    value: central,
    unit: 'u',
    status: 'verified',
    source: cite(`${name}-central`),
    range: {
      low,
      high,
      lowSource: url ? cite(`${name}-low`) : { citation: '', url: '' },
      highSource: cite(`${name}-high`),
    },
  };
}

const table: ParameterTable = {
  'socialHousing.rentPerUnit': ranged(10, 20, 30, 'rent'),
  'migration.commuteCostPerMinute': ranged(1, 2, 3, 'commute'),
  'ghost.commuteThreshold': ranged(40, 50, 60, 'threshold', false),
  'rentSubsidy.passThrough': { kind: 'scalar', value: 0.5, unit: 'ratio', status: 'verified', source: cite('pass') },
  'other.param': ranged(1, 2, 3, 'other'),
};

describe('scenarioOfMin / scenarioOfMax', () => {
  it('min from low and min from high', () => {
    expect(scenarioOfMin({ low: 1, central: 2, high: 3 })).toBe('low');
    expect(scenarioOfMin({ low: 3, central: 2, high: 1 })).toBe('high');
  });
  it('max from high and max from low', () => {
    expect(scenarioOfMax({ low: 1, central: 2, high: 3 })).toBe('high');
    expect(scenarioOfMax({ low: 3, central: 2, high: 1 })).toBe('low');
  });
  it('ties pick low, high, central order for min and high, low, central for max', () => {
    expect(scenarioOfMin({ low: 2, central: 2, high: 2 })).toBe('low');
    expect(scenarioOfMin({ low: 3, central: 1, high: 1 })).toBe('high');
    expect(scenarioOfMin({ low: 3, central: 1, high: 2 })).toBe('central');
    expect(scenarioOfMax({ low: 2, central: 2, high: 2 })).toBe('high');
    expect(scenarioOfMax({ low: 3, central: 1, high: 3 })).toBe('high');
    expect(scenarioOfMax({ low: 1, central: 3, high: 2 })).toBe('central');
  });
});

describe('assumptionsFor', () => {
  it('values equal scenarioTable and ids follow the effect order, skipping absent ids', () => {
    for (const s of ['low', 'central', 'high'] as const) {
      const t = scenarioTable(table, s);
      const out = assumptionsFor(table, s);
      expect(out.map((a) => a.parameterId)).toEqual([
        'socialHousing.rentPerUnit',
        'rentSubsidy.passThrough',
        'ghost.commuteThreshold',
        'migration.commuteCostPerMinute',
      ]);
      for (const a of out) expect((t[a.parameterId] as ScalarParameter).value).toBe(a.value);
    }
  });

  it('low-is-strongest: low Scenario takes range.low and cites lowSource; high takes range.high', () => {
    const lo = assumptionsFor(table, 'low').find((a) => a.parameterId === 'socialHousing.rentPerUnit');
    const hi = assumptionsFor(table, 'high').find((a) => a.parameterId === 'socialHousing.rentPerUnit');
    expect(lo).toMatchObject({ value: 10, citation: 'rent-low citation', url: 'https://example.org/rent-low' });
    expect(hi).toMatchObject({ value: 30, citation: 'rent-high citation', url: 'https://example.org/rent-high' });
  });

  it('high-is-strongest: migration.commuteCostPerMinute in low Scenario takes range.high and cites highSource', () => {
    const lo = assumptionsFor(table, 'low').find((a) => a.parameterId === 'migration.commuteCostPerMinute');
    const hi = assumptionsFor(table, 'high').find((a) => a.parameterId === 'migration.commuteCostPerMinute');
    expect(lo).toMatchObject({ value: 3, citation: 'commute-high citation', url: 'https://example.org/commute-high' });
    expect(hi).toMatchObject({ value: 1, citation: 'commute-low citation', url: 'https://example.org/commute-low' });
  });

  it('central cites the main source and an unranged value cites its source', () => {
    const c = assumptionsFor(table, 'central');
    expect(c.find((a) => a.parameterId === 'socialHousing.rentPerUnit')).toMatchObject({
      value: 20,
      citation: 'rent-central citation',
    });
    expect(assumptionsFor(table, 'low').find((a) => a.parameterId === 'rentSubsidy.passThrough')).toMatchObject({
      value: 0.5,
      citation: 'pass citation',
    });
  });

  it('empty citation or URL becomes null and no Scenario name appears in the result', () => {
    const lo = assumptionsFor(table, 'low');
    expect(lo.find((a) => a.parameterId === 'ghost.commuteThreshold')).toMatchObject({ citation: null, url: null });
    expect(JSON.stringify(lo)).not.toMatch(/"(scenario|low|high|central)"/);
  });
});
