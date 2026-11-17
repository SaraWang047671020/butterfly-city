import { describe, expect, it } from 'vitest';
import { population2025Mean, surveyCheck, surveyCheckLine, type SurveyCheckInput } from '../../../../scripts/pipeline/commute/survey-check.ts';
import type { DistrictSeries } from '../../../../scripts/pipeline/indicators/series.ts';

// Origins N1, N2 (New Taipei) and targets T1, T2 (Taipei). Only the N -> T cells enter the mean.
const INPUT: SurveyCheckInput = {
  codes: ['T1', 'T2', 'N1', 'N2'],
  minutes: [
    [0, 9, 9, 9],
    [9, 0, 9, 9],
    [40, 60, 0, 9], // N1 -> T1, T2
    [50, 70, 9, 0], // N2 -> T1, T2
  ],
  cityOf: new Map([
    ['T1', 'Taipei'],
    ['T2', 'Taipei'],
    ['N1', 'New Taipei'],
    ['N2', 'New Taipei'],
  ]),
  population: new Map([
    ['N1', 100],
    ['N2', 300],
    ['T1', 5000],
    ['T2', 7000],
  ]),
  jobShare: new Map([
    ['T1', 0.6],
    ['T2', 0.2],
    ['N1', 0.1],
    ['N2', 0.1],
  ]),
};

describe('surveyCheck', () => {
  it('computes the population- and job-share-weighted mean on a 2 x 2 fixture', () => {
    // (100 * (0.6 * 40 + 0.2 * 60) + 300 * (0.6 * 50 + 0.2 * 70)) / (400 * 0.8) = 16800 / 320 = 52.5
    const r = surveyCheck(INPUT);
    expect(r.modelled).toBeCloseTo(52.5, 9);
    expect(r.survey).toBe(57);
    expect(r.difference).toBeCloseTo(-4.5, 9);
    expect(surveyCheckLine(r)).toBe('commute check: modelled 52.5 min, survey about 57 min, difference -4.5');
  });

  it('prints a plus sign for a positive difference', () => {
    expect(surveyCheckLine({ modelled: 60.04, survey: 57, difference: 3.04 })).toBe(
      'commute check: modelled 60.0 min, survey about 57 min, difference +3.0',
    );
  });

  it('does not depend on district order', () => {
    const perm: SurveyCheckInput = {
      ...INPUT,
      codes: ['N2', 'T2', 'N1', 'T1'],
      minutes: [
        [0, 70, 9, 50],
        [9, 0, 9, 9],
        [9, 60, 0, 40],
        [9, 9, 9, 0],
      ],
    };
    expect(surveyCheck(perm).modelled).toBeCloseTo(52.5, 9);
  });

  it('throws when a city has no district', () => {
    expect(() => surveyCheck({ ...INPUT, cityOf: new Map(INPUT.codes.map((c) => [c, 'Taipei'])) })).toThrow(/both cities/);
  });

  it('throws when a district has no population', () => {
    const population = new Map(INPUT.population);
    population.delete('N2');
    expect(() => surveyCheck({ ...INPUT, population })).toThrow(/no population for district N2/);
  });
});

describe('population2025Mean', () => {
  const rec = (value: number) => ({ value, estimated: false });
  it('averages the last four quarter-end values', () => {
    const series = { D1: [rec(1000), rec(10), rec(20), rec(30), rec(40)] } as unknown as DistrictSeries;
    expect(population2025Mean(series).get('D1')).toBe(25);
  });

  it('throws for fewer than four quarters', () => {
    const series = { D1: [rec(1), rec(2), rec(3)] } as unknown as DistrictSeries;
    expect(() => population2025Mean(series)).toThrow(/fewer than 4 quarters/);
  });
});
