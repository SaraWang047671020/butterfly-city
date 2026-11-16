import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { buildSocialHousingStarts } from '../../../scripts/pipeline/policy/social-housing-starts.ts';
import type { SocialHousingDetail, SocialHousingProject } from '../../../scripts/pipeline/parsers/social-housing.ts';

const XINYI = '63000020';
const ZHONGHE = '65000030';
const quarters: Quarter[] = ['2015Q1', '2015Q2', '2015Q3', '2015Q4'];

function project(guid: string, start: string, units: number, extra: Partial<SocialHousingProject> = {}): SocialHousingProject {
  return { guid, status: '已完工', householdNum: units, strStartDate: start, strEndDate: '', city: 'Taipei', file: 'a.json', ...extra };
}

function detail(guid: string, cityCode: string, townCode: string): [string, SocialHousingDetail] {
  return [guid, { guid, cityCode, townCode }];
}

const projects: SocialHousingProject[] = [
  project('S1', '104/02/15', 10, { status: '興建中' }), // any status counts: Xinyi 2015Q1
  project('S2', '104/03/31', 5), // Xinyi 2015Q1
  project('S3', '104/12/01', 7, { city: 'New Taipei' }), // Zhonghe 2015Q4
  project('S1', '104/02/15', 999), // duplicate guid: ignored
  project('S5', '', 20), // empty start date
  project('S6', '104/13/01', 30, { city: 'New Taipei' }), // unparseable start date
  project('S7', '104/05/05', 40, { city: 'New Taipei' }), // no detail file
  project('S8', '104/05/05', 50, { city: 'New Taipei' }), // TownCode outside the 41
  project('S9', '103/12/31', 8), // starts before 2015Q1: in no quarter, not excluded
  project('S10', '116/01/01', 9), // starts after 2025Q4: in no quarter, not excluded
];
const details = new Map<string, SocialHousingDetail>([
  detail('S1', 'A', XINYI),
  detail('S2', 'A', XINYI),
  detail('S3', 'F', ZHONGHE),
  detail('S5', 'A', XINYI),
  detail('S6', 'F', ZHONGHE),
  detail('S8', 'F', '99'),
  detail('S9', 'A', XINYI),
  detail('S10', 'A', XINYI),
]);

describe('buildSocialHousingStarts', () => {
  const result = buildSocialHousingStarts(projects, details, DISTRICTS, quarters);
  const values = (code: string): number[] => result.series[code]!.map((r) => r.value);

  it('sums units of projects of any status by start quarter, counting each guid once', () => {
    expect(values(XINYI)).toEqual([15, 0, 0, 0]);
    expect(values(ZHONGHE)).toEqual([0, 0, 0, 7]);
    expect(values('63000010')).toEqual([0, 0, 0, 0]);
  });

  it('has 41 districts of observed records with the portal source', () => {
    expect(Object.keys(result.series)).toHaveLength(41);
    for (const rows of Object.values(result.series)) {
      expect(rows).toHaveLength(4);
      for (const r of rows) expect(r).toMatchObject({ source: 'social-housing/nlma-portal', estimated: false });
    }
  });

  it('excludes projects without a usable date, detail file or district, with reasons and city totals', () => {
    expect(result.exclusions.map((e) => [e.guid, e.reason, e.units, e.city])).toEqual([
      ['S5', 'empty start date', 20, 'Taipei'],
      ['S6', 'unparseable start date', 30, 'New Taipei'],
      ['S7', 'no detail file', 40, 'New Taipei'],
      ['S8', 'TownCode outside the 41', 50, 'New Taipei'],
    ]);
    expect(result.notes).toContain('social housing starts: excluded S7: no detail file, 40 units, New Taipei');
    expect(result.notes.at(-1)).toBe('social housing starts: excluded 4 projects, units per city: New Taipei 120, Taipei 20');
  });

  it('reports no exclusions when every project qualifies', () => {
    const r = buildSocialHousingStarts([project('S2', '104/03/31', 5)], details, DISTRICTS, quarters);
    expect(r.exclusions).toEqual([]);
    expect(r.notes).toEqual(['social housing starts: no projects excluded']);
  });
});
