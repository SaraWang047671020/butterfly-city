import { describe, expect, it } from 'vitest';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';
import {
  deriveRentPerUnit,
  deriveSocialHousingLag,
  deriveUnitCost,
  parseUnitCostCases,
} from '../../../../scripts/pipeline/params/social-housing.ts';
import type { SocialHousingProject } from '../../../../scripts/pipeline/parsers/social-housing.ts';

/** Project starting 2015Q1 and completing `lag` quarters later (ROC dates). */
function proj(guid: string, lag: number | undefined, extra: Partial<SocialHousingProject> = {}): SocialHousingProject {
  const end = lag === undefined ? '' : `${104 + Math.floor(lag / 4)}/${String(1 + 3 * (lag % 4)).padStart(2, '0')}/10`;
  return { guid, status: '已完工', householdNum: 100, strStartDate: '104/01/10', strEndDate: end, city: 'Taipei', file: 'f.json', ...extra };
}

const ten = Array.from({ length: 10 }, (_, i) => proj(`p${i}`, i));

describe('deriveSocialHousingLag', () => {
  it('gives median 5, quartiles 2 and 7 and cites NLMA for lags 0..9', () => {
    const r = deriveSocialHousingLag(ten);
    expect(r.durations).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.entry.value).toBe(5);
    expect(r.entry.range).toMatchObject({ low: 2, high: 7 });
    expect(r.entry.estimated?.method).toContain('NLMA');
    expect(r.zeroLagGuids).toEqual(['p0']);
  });

  it('counts a repeated guid once, ignores projects under construction and tallies exclusions', () => {
    const r = deriveSocialHousingLag([
      ...ten,
      proj('p1', 8),
      proj('u1', 3, { status: '興建中' }),
      proj('e1', undefined),
      proj('b1', 0, { strStartDate: '104/07/10' }),
      proj('o1', 0, { strEndDate: '103/12/10' }),
    ]);
    expect(r.qualifying).toBe(10);
    expect(r.excluded['empty end date']).toBe(1);
    expect(r.excluded['end before start']).toBe(1);
    expect(r.excluded['completion outside 2015Q1-2025Q4']).toBe(1);
  });

  it('stops with fewer than 10 qualifying projects', () => {
    expect(() => deriveSocialHousingLag(ten.slice(0, 9))).toThrow(DataError);
    expect(() => deriveSocialHousingLag(ten.slice(0, 9))).toThrow(/social-housing-lag-too-few-projects/);
  });
});

const CASES_HEADER = 'project,total_twd,dwellings,stated_per_dwelling_twd';
const cases = (rows: string[]) => parseUnitCostCases([CASES_HEADER, ...rows].join('\n') + '\n', 'cases.csv');

describe('unitCost', () => {
  const ok = ['A,3000000000,1000,3000000', 'B,4000000000,1000,4000000', 'C,5000000000,1000,5000000'];

  it('takes the middle stated figure and the smallest and largest as range', () => {
    const r = deriveUnitCost(cases(ok));
    expect(r.entry.value).toBe(4_000_000);
    expect(r.entry.range).toMatchObject({ low: 3_000_000, high: 5_000_000 });
    expect(r.quotients).toEqual([3_000_000, 4_000_000, 5_000_000]);
  });

  it('accepts a 0.66 percent difference and stops at 1.6 percent', () => {
    expect(() => deriveUnitCost(cases(['A,3000000000,1000,3020000', ok[1]!, ok[2]!]))).not.toThrow();
    expect(() => deriveUnitCost(cases(['A,3000000000,1000,3050000', ok[1]!, ok[2]!]))).toThrow(/social-housing-unit-cost-mismatch/);
  });

  it('needs exactly three projects', () => {
    expect(() => deriveUnitCost(cases(ok.slice(0, 2)))).toThrow(/unit-cost-case-count/);
  });

  it('rejects a missing column', () => {
    expect(() => parseUnitCostCases('project,total_twd,dwellings\nA,1,1\n', 'cases.csv')).toThrow(ParseError);
  });
});

describe('rentPerUnit', () => {
  const quarters = ['2024Q1', '2024Q2', '2024Q3', '2024Q4'] as never;
  const series = (v: number) => Array.from({ length: 4 }, () => ({ value: v }));
  const rent = { '63000010': series(100), '63000020': series(100) } as never;

  it('scales -2.5 % and +6.5 % of the median rent by the median unit count', () => {
    const projects = [100, 200, 300].map((n, i) => proj(`q${i}`, 1, { householdNum: n }));
    const r = deriveRentPerUnit(projects, rent, quarters);
    expect(r.rentRef).toBe(100);
    expect(r.unitsPerProject).toBe(200);
    expect(r.entry.value).toBe(0);
    expect(r.entry.range?.low).toBeCloseTo(-0.0125, 10);
    expect(r.entry.range?.high).toBeCloseTo(0.0325, 10);
  });

  it('stops when a 2024 rent value is missing', () => {
    const bad = { '63000010': [{ value: 100 }, { value: null }, { value: 100 }, { value: 100 }] } as never;
    expect(() => deriveRentPerUnit([proj('q', 1)], bad, quarters)).toThrow(/social-housing-rent-missing/);
  });
});
