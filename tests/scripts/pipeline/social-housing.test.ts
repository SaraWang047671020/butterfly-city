import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  buildSocialHousing,
  loadSocialHousing,
  resolveProjectDistricts,
  socialHousingStep,
} from '../../../scripts/pipeline/indicators/social-housing.ts';
import {
  parseProjectDetail,
  parseRocSlashDate,
  parseScheduleList,
} from '../../../scripts/pipeline/parsers/social-housing.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

const XINYI = '63000020';
const ZHONGHE = '65000030';
const quarters: Quarter[] = ['2015Q1', '2015Q2', '2015Q3', '2015Q4'];

interface RowSpec {
  guid: string;
  city?: string;
  status?: string;
  units?: string;
  start?: string;
  end?: string;
}

function listJson(rows: RowSpec[]): string {
  return JSON.stringify({
    Code: 200,
    Data: {
      success: true,
      data: rows.map((r) => ({
        setupplan_guid: r.guid,
        city_name: r.city ?? '臺北市',
        execute_status_description: r.status ?? '已完工',
        household_num: r.units ?? '1',
        strStartDate: r.start ?? '',
        strEndDate: r.end ?? '',
      })),
    },
  });
}

function detailJson(guid: string, cityCode: string, townCode: string): string {
  return JSON.stringify({ d: { Data: { SetupplanGuid: guid, CityCode: cityCode, TownCode: townCode } } });
}

const listA: RowSpec[] = [
  { guid: 'P1', end: '60/01/01', units: '60' }, // 1971, stock base
  { guid: 'P2', end: '103/12/31', units: '10' }, // 2014Q4, stock base
  { guid: 'P3', end: '104/02/15', units: '5' }, // 2015Q1
  { guid: 'P4', end: '104/12/31', units: '7' }, // 2015Q4
  { guid: 'P6', status: '興建中', end: '', units: '999' }, // not completed: ignored
  { guid: 'P8', end: '', units: '20' }, // empty end date
  { guid: 'P9', end: '104/13/01', units: '30' }, // unparseable end date
  { guid: 'P12', end: '115/03/31', units: '8' }, // 2026Q1: after the last quarter
];
const listF: RowSpec[] = [
  { guid: 'P5', city: '新北市', end: '104/07/01', units: '100' }, // 2015Q3
  { guid: 'P1', city: '新北市', end: '104/07/01', units: '777' }, // duplicate guid: ignored
  { guid: 'P10', city: '新北市', end: '104/05/05', units: '40' }, // no detail file
  { guid: 'P11', city: '新北市', end: '104/05/05', units: '50' }, // TownCode outside the 41
];
const details: Record<string, [string, string]> = {
  P1: ['A', '17'],
  P2: ['A', '17'],
  P3: ['A', '17'],
  P4: ['A', '17'],
  P5: ['F', '18'],
  P6: ['A', '17'],
  P8: ['A', '17'],
  P9: ['A', '17'],
  P11: ['F', '99'],
  P12: ['A', '17'],
};

function files(): Record<string, string> {
  const out: Record<string, string> = {
    'social-housing/nlma-portal-GetScheduleData-A.json': listJson(listA),
    'social-housing/nlma-portal-GetScheduleData-F.json': listJson(listF),
  };
  for (const [guid, [city, town]] of Object.entries(details)) {
    out[`social-housing/nlma-portal-dashboard/${guid}.json`] = detailJson(guid, city, town);
  }
  return out;
}

describe('parseScheduleList', () => {
  it('reads projects with validated unit counts', () => {
    const rows = parseScheduleList(listJson([{ guid: 'G', city: '新北市', status: '興建中', units: '442', start: '113/12/12' }]), 'f.json');
    expect(rows).toEqual([
      { guid: 'G', status: '興建中', householdNum: 442, strStartDate: '113/12/12', strEndDate: '', city: 'New Taipei', file: 'f.json' },
    ]);
  });

  it('throws ParseError for a missing field or a missing data array', () => {
    const bad = JSON.stringify({ Data: { data: [{ setupplan_guid: 'G', household_num: '1' }] } });
    expect(() => parseScheduleList(bad, 'f.json')).toThrow(ParseError);
    expect(() => parseScheduleList('{"Data":{}}', 'f.json')).toThrow(ParseError);
    expect(() => parseScheduleList('not json', 'f.json')).toThrow(ParseError);
  });

  it.each(['', '12.5', '-3', '1e3', 'abc', ' '])('stops on invalid household_num %j, naming file and guid', (value) => {
    const run = (): unknown => parseScheduleList(listJson([{ guid: 'BAD-GUID', units: value }]), 'data/raw/x.json');
    expect(run).toThrow(DataError);
    try {
      run();
    } catch (error) {
      const e = error as DataError;
      expect(e.message).toContain('BAD-GUID');
      expect(e.details.join('\n')).toContain('data/raw/x.json');
      expect(e.details.join('\n')).toContain(JSON.stringify(value.trim()));
    }
  });
});

describe('parseProjectDetail', () => {
  it('reads guid, city code and town code', () => {
    expect(parseProjectDetail(detailJson('G', 'A', '17'), 'd.json')).toEqual({ guid: 'G', cityCode: 'A', townCode: '17' });
  });

  it('throws ParseError when the town code or data object is missing', () => {
    expect(() => parseProjectDetail(JSON.stringify({ d: { Data: { SetupplanGuid: 'G' } } }), 'd.json')).toThrow(ParseError);
    expect(() => parseProjectDetail(JSON.stringify({ d: {} }), 'd.json')).toThrow(ParseError);
  });
});

describe('parseRocSlashDate', () => {
  it('converts ROC dates and rejects impossible ones', () => {
    expect(parseRocSlashDate('104/02/15')).toEqual({ year: 2015, month: 2, day: 15, quarter: 1 });
    expect(parseRocSlashDate('60/01/01')?.year).toBe(1971);
    expect(parseRocSlashDate('')).toBeUndefined();
    expect(parseRocSlashDate('104/02/30')).toBeUndefined();
    expect(parseRocSlashDate('104/13/01')).toBeUndefined();
    expect(parseRocSlashDate('(預計)115/03/31')).toBeUndefined();
  });
});

describe('loadSocialHousing', () => {
  it('dedupes by guid in sorted file order and tolerates missing detail files', () => {
    const load = loadSocialHousing({ reader: new MemoryRawReader(files()) });
    expect(load.projects.map((p) => p.guid)).toEqual(['P1', 'P2', 'P3', 'P4', 'P6', 'P8', 'P9', 'P12', 'P5', 'P10', 'P11']);
    expect(load.projects.find((p) => p.guid === 'P1')?.householdNum).toBe(60);
    expect(load.details.has('P10')).toBe(false);
    expect(load.details.get('P5')).toEqual({ guid: 'P5', cityCode: 'F', townCode: '18' });
    expect(load.listFiles).toEqual([
      'data/raw/social-housing/nlma-portal-GetScheduleData-A.json',
      'data/raw/social-housing/nlma-portal-GetScheduleData-F.json',
    ]);
  });

  it('rejects a detail file that belongs to another project', () => {
    const f = files();
    f['social-housing/nlma-portal-dashboard/P2.json'] = detailJson('OTHER', 'A', '17');
    expect(() => loadSocialHousing({ reader: new MemoryRawReader(f) })).toThrow(ParseError);
  });
});

describe('buildSocialHousing', () => {
  const load = loadSocialHousing({ reader: new MemoryRawReader(files()) });
  const result = buildSocialHousing(load.projects, load.details, DISTRICTS, quarters);
  const values = (series: Record<string, { value: number | null }[]>, code: string): (number | null)[] =>
    (series[code] ?? []).map((r) => r.value);

  it('counts completions per quarter and keeps pre-2015 projects in the stock base', () => {
    expect(values(result.completions, XINYI)).toEqual([5, 0, 0, 7]);
    expect(values(result.stock, XINYI)).toEqual([75, 75, 75, 82]); // base 60 + 10
    expect(values(result.completions, ZHONGHE)).toEqual([0, 0, 100, 0]);
    expect(values(result.stock, ZHONGHE)).toEqual([0, 0, 100, 100]); // duplicate guid P1 not counted twice
  });

  it('gives every district 4 non-estimated records, zero where nothing happened', () => {
    expect(Object.keys(result.stock)).toHaveLength(41);
    for (const series of [result.completions, result.stock]) {
      for (const records of Object.values(series)) {
        expect(records).toHaveLength(4);
        expect(records.every((r) => !r.estimated)).toBe(true);
      }
    }
    expect(values(result.stock, '63000010')).toEqual([0, 0, 0, 0]);
  });

  it('excludes projects with an empty or bad date, no detail file or an unknown TownCode', () => {
    expect(result.exclusions).toEqual([
      { guid: 'P8', reason: 'empty end date', units: 20, city: 'Taipei' },
      { guid: 'P9', reason: 'unparseable end date', units: 30, city: 'Taipei' },
      { guid: 'P10', reason: 'no detail file', units: 40, city: 'New Taipei' },
      { guid: 'P11', reason: 'TownCode outside the 41', units: 50, city: 'New Taipei' },
    ]);
    expect(result.notes).toEqual([
      'social housing: excluded P8: empty end date, 20 units, Taipei',
      'social housing: excluded P9: unparseable end date, 30 units, Taipei',
      'social housing: excluded P10: no detail file, 40 units, New Taipei',
      'social housing: excluded P11: TownCode outside the 41, 50 units, New Taipei',
      'social housing: excluded 4 projects, units per city: New Taipei 90, Taipei 50',
    ]);
  });

  it('reports no exclusions when every project is usable', () => {
    const ok = buildSocialHousing(load.projects.filter((p) => p.guid === 'P3'), load.details, DISTRICTS, quarters);
    expect(ok.notes).toEqual(['social housing: no projects excluded']);
  });

  it('accepts a TownCode that is already one of the 41 codes', () => {
    const detail = { guid: 'X', cityCode: '', townCode: XINYI };
    const project = parseScheduleList(listJson([{ guid: 'X', end: '104/01/01', units: '9' }]), 'f.json');
    const r = buildSocialHousing(project, new Map([['X', detail]]), DISTRICTS, quarters);
    expect(values(r.stock, XINYI)).toEqual([9, 9, 9, 9]);
  });
});

describe('resolveProjectDistricts', () => {
  it('serves the policy starts series: any status, deduped, with district or problem', () => {
    const load = loadSocialHousing({ reader: new MemoryRawReader(files()) });
    const resolved = resolveProjectDistricts(load.projects, load.details, DISTRICTS);
    expect(resolved).toHaveLength(11);
    const byGuid = new Map(resolved.map((r) => [r.project.guid, r]));
    expect(byGuid.get('P6')?.districtCode).toBe(XINYI);
    expect(byGuid.get('P6')?.project.status).toBe('興建中');
    expect(byGuid.get('P10')?.districtProblem).toBe('no detail file');
    expect(byGuid.get('P11')?.districtProblem).toBe('TownCode outside the 41');
  });
});

describe('socialHousingStep', () => {
  it('fills the build state and adds the exclusion notes', () => {
    const ctx = createContext({ reader: new MemoryRawReader(files()), logger: memoryLogger() });
    const state = createState();
    socialHousingStep().run(ctx, state);
    expect(state.socialHousing?.projects).toHaveLength(11);
    expect(state.socialHousingCompletions?.[XINYI]).toHaveLength(44);
    expect(state.socialHousingStock?.[XINYI]?.[43]?.value).toBe(5 + 7 + 70);
    expect(state.socialHousingExclusions).toHaveLength(4);
    expect(state.notes.at(-1)).toBe('social housing: excluded 4 projects, units per city: New Taipei 90, Taipei 50');
  });
});
