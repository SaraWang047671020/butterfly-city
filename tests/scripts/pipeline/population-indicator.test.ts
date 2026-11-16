import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { memoryLogger, type BuildContext } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import {
  buildPopulation,
  populationFiles,
  populationMonths,
  populationStep,
} from '../../../scripts/pipeline/indicators/population.ts';
import type { PopulationVillageRow } from '../../../scripts/pipeline/parsers/household.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';

const A = '63000070'; // Wanhua
const B = '65000010'; // Banqiao
const districts = [{ code: A }, { code: B }];

const row = (month: string, districtCode: string, village: string, peopleTotal: number): PopulationVillageRow => ({
  month,
  districtCode,
  village,
  peopleTotal,
});

describe('population month to file table', () => {
  it('uses ODRP005 CSV through 2017-12 and ODRP014 JSON per county from 2018-03', () => {
    expect(populationFiles('10612')).toEqual([{ path: 'population/ris/ODRP005-10612.csv', format: 'csv' }]);
    expect(populationFiles('10703')).toEqual([
      { path: 'population/ris/ODRP014-10703-臺北市.json', format: 'json' },
      { path: 'population/ris/ODRP014-10703-新北市.json', format: 'json' },
    ]);
  });

  it('reads the last month of each quarter', () => {
    expect(populationMonths(['2015Q1', '2015Q2', '2018Q4'])).toEqual(['10403', '10406', '10712']);
  });
});

describe('buildPopulation', () => {
  const quarters: Quarter[] = ['2015Q1', '2015Q2'];
  const rows = new Map([
    ['10403', [row('10403', A, 'v1', 100), row('10403', A, 'v2', 50), row('10403', B, 'v1', 7)]],
    ['10406', [row('10406', A, 'v1', 101), row('10406', B, 'v1', 8), row('10406', B, 'v2', 0)]],
  ]);

  it('sums village rows per district in the last month of each quarter', () => {
    const s = buildPopulation(rows, districts, quarters);
    expect(s[A]).toEqual([
      { value: 150, estimated: false },
      { value: 101, estimated: false },
    ]);
    expect(s[B]).toEqual([
      { value: 7, estimated: false },
      { value: 8, estimated: false },
    ]);
  });

  it('throws for a missing or empty month', () => {
    const missing = new Map([['10403', rows.get('10403')!]]);
    expect(() => buildPopulation(missing, districts, quarters)).toThrow(DataError);
    expect(() => buildPopulation(new Map([...missing, ['10406', []]]), districts, quarters)).toThrow(/missing-month/);
  });

  it('throws for a district without rows in a month', () => {
    const noB = new Map([...rows, ['10406', [row('10406', A, 'v1', 1)]]]);
    expect(() => buildPopulation(noB, districts, quarters)).toThrow(/missing-district-month: population 10406 district 65000010/);
  });

  it.each([-1, 1.5, Number.NaN])('throws for an invalid count %s', (bad) => {
    const m = new Map([...rows, ['10403', [row('10403', A, 'v1', bad), row('10403', B, 'v1', 1)]]]);
    expect(() => buildPopulation(m, districts, quarters)).toThrow(/invalid-count/);
  });

  it('throws when a row carries a different month than its file', () => {
    const m = new Map([...rows, ['10403', [row('10402', A, 'v1', 1), row('10403', B, 'v1', 1)]]]);
    expect(() => buildPopulation(m, districts, quarters)).toThrow(/month-mismatch/);
  });
});

describe('populationStep', () => {
  it('reads ODRP014 JSON files through the reader and stores the series in the state', () => {
    const json = (site: string, total: number) =>
      JSON.stringify([{ statistic_yyymm: '10703', site_id: site, village: 'x', people_total: String(total) }]);
    const reader = new MemoryRawReader({
      'population/ris/ODRP014-10703-臺北市.json': json('臺北市萬華區', 12),
      'population/ris/ODRP014-10703-新北市.json': json('新北市板橋區', 34),
    });
    const ctx: BuildContext = {
      reader,
      districts: DISTRICTS.filter((d) => d.code === A || d.code === B),
      quarters: ['2018Q1'],
      logger: memoryLogger(),
    };
    const state = createState();
    populationStep().run(ctx, state);
    expect(state.population?.[A]).toEqual([{ value: 12, estimated: false }]);
    expect(state.population?.[B]).toEqual([{ value: 34, estimated: false }]);
  });
});
