import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { memoryLogger, type BuildContext } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import {
  buildMigration,
  migrationFiles,
  migrationMonths,
  migrationStep,
} from '../../../scripts/pipeline/indicators/migration.ts';
import type { MigrationVillageRow } from '../../../scripts/pipeline/parsers/household.ts';
import type { AnnualMigrationRow } from '../../../scripts/pipeline/parsers/migration-annual.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

const A = '63000070'; // Wanhua
const B = '65000010'; // Banqiao
const districts = [{ code: A }, { code: B }];

const row = (month: string, districtCode: string, inTotal: number, outTotal: number, village = 'v1'): MigrationVillageRow => ({
  month,
  districtCode,
  village,
  inMale: inTotal,
  inFemale: 0,
  outMale: outTotal,
  outFemale: 0,
});

/** Months 10412 and 10501..10503, plus 10504..10511 so the 2016 weights exist. */
function monthlyFixture(): Map<string, MigrationVillageRow[]> {
  const m = new Map<string, MigrationVillageRow[]>();
  // December 2015: A in 10 (two villages, male and female), out 5; B in 0, out 1.
  m.set('10412', [
    { month: '10412', districtCode: A, village: 'v1', inMale: 4, inFemale: 2, outMale: 3, outFemale: 0 },
    { month: '10412', districtCode: A, village: 'v2', inMale: 3, inFemale: 1, outMale: 1, outFemale: 1 },
    row('10412', B, 0, 1),
  ]);
  for (let i = 1; i <= 11; i++) {
    const month = `105${String(i).padStart(2, '0')}`;
    // A: weight 1 in every month for in and out. B: in all zero; out only in January.
    m.set(month, [row(month, A, 1, 1), row(month, B, 0, i === 1 ? 10 : 0)]);
  }
  return m;
}

const annual: AnnualMigrationRow[] = [
  { districtCode: A, year: 2015, moveIn: 100, moveOut: 50 },
  { districtCode: B, year: 2015, moveIn: 22, moveOut: 11 },
];
const quarters: Quarter[] = ['2015Q1', '2015Q2', '2015Q3', '2015Q4', '2016Q1'];
const values = (rs: readonly { value: number | null }[]) => rs.map((r) => r.value);

describe('migration month to file table', () => {
  it('maps months to ODRP002, ODRP011 JSON and the ODRP011 CSV month', () => {
    expect(migrationFiles('10412')).toEqual([{ path: 'population/ris/ODRP002-10412.csv', format: 'csv' }]);
    expect(migrationFiles('10612')).toEqual([{ path: 'population/ris/ODRP002-10612.csv', format: 'csv' }]);
    expect(migrationFiles('10701')).toEqual([
      { path: 'population/ris/ODRP011-10701-臺北市.json', format: 'json' },
      { path: 'population/ris/ODRP011-10701-新北市.json', format: 'json' },
    ]);
    expect(migrationFiles('11308')).toEqual([{ path: 'population/ris/ODRP011-11308.csv', format: 'csv' }]);
  });

  it('asks for 2015-12 and the eleven 2016 weight months instead of the split months', () => {
    const months = migrationMonths(['2015Q1', '2015Q4']);
    expect(months).toContain('10412');
    expect(months).toContain('10501');
    expect(months).toContain('10511');
    expect(months).not.toContain('10401');
    expect(months).not.toContain('10411');
    expect(migrationMonths(['2016Q1'])).toEqual(['10501', '10502', '10503']);
  });
});

describe('buildMigration', () => {
  it('splits 2015 with apportion and sums three months per quarter', () => {
    const { moveIn, moveOut } = buildMigration(monthlyFixture(), annual, districts, quarters);
    // A in: R = 100 - 10 = 90 over 11 equal weights -> [9, 9, 8 x 9]; December is 10.
    expect(values(moveIn[A]!)).toEqual([26, 24, 24, 26, 3]);
    // A out: December out is 3+0+1+1 = 5, R = 45 -> [5, 4 x 10].
    expect(values(moveOut[A]!)).toEqual([13, 12, 12, 13, 3]);
    // B in: all-zero 2016 weights -> equal split of R = 22 -> 2 per month; December 0.
    expect(values(moveIn[B]!)).toEqual([6, 6, 6, 4, 0]);
    // B out: R = 11 - 1 = 10, all weight in January -> 10 in Q1; December 1 closes Q4.
    expect(values(moveOut[B]!)).toEqual([10, 0, 0, 1, 10]); // 2016Q1 holds the 10 of January 2016
  });

  it('conserves the annual total of 2015', () => {
    const { moveIn, moveOut } = buildMigration(monthlyFixture(), annual, districts, quarters);
    const sum = (rs: readonly { value: number | null }[]) => rs.slice(0, 4).reduce((s, r) => s + (r.value ?? 0), 0);
    expect(sum(moveIn[A]!)).toBe(100);
    expect(sum(moveOut[A]!)).toBe(50);
    expect(sum(moveIn[B]!)).toBe(22);
    expect(sum(moveOut[B]!)).toBe(11);
  });

  it('flags 2015 quarters as estimated with the split method and later quarters as real', () => {
    const { moveIn } = buildMigration(monthlyFixture(), annual, districts, quarters);
    for (const r of moveIn[A]!.slice(0, 4)) {
      expect(r.estimated).toBe(true);
      expect((r as { method?: string }).method).toBe('migration-2015-seasonal-split');
    }
    const last = moveIn[A]![4]!;
    expect(last).toEqual({ value: 3, estimated: false });
    expect('method' in last).toBe(false);
  });

  it('needs no annual totals when no 2015 quarter is requested', () => {
    const { moveIn } = buildMigration(monthlyFixture(), [], districts, ['2016Q1']);
    expect(values(moveIn[A]!)).toEqual([3]);
  });

  it('stops with district, indicator, annual total and December count for a negative remainder', () => {
    const bad = [{ districtCode: A, year: 2015, moveIn: 5, moveOut: 50 }, annual[1]!];
    let error: unknown;
    try {
      buildMigration(monthlyFixture(), bad, districts, quarters);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    const e = error as DataError;
    expect(e.message).toContain(A);
    expect(e.message).toContain('moveIn');
    expect(e.details).toEqual(['annual total 2015: 5', '2015-12 count: 10']);
  });

  it('throws for a missing month', () => {
    const m = monthlyFixture();
    m.delete('10507');
    expect(() => buildMigration(m, annual, districts, quarters)).toThrow(/missing-month: migration 10507/);
  });

  it('throws for a district without rows in a month', () => {
    const m = monthlyFixture();
    m.set('10412', [row('10412', A, 10, 5)]);
    expect(() => buildMigration(m, annual, districts, quarters)).toThrow(/missing-district-month: migration 10412 district 65000010/);
  });

  it('throws for a missing annual row', () => {
    expect(() => buildMigration(monthlyFixture(), [annual[0]!], districts, quarters)).toThrow(/missing-annual-total/);
  });

  it.each([-1, 2.5])('throws for an invalid count %s', (bad) => {
    const m = monthlyFixture();
    m.set('10502', [{ ...row('10502', A, 1, 1), inFemale: bad }, row('10502', B, 0, 0)]);
    expect(() => buildMigration(m, annual, districts, quarters)).toThrow(/invalid-count/);
  });
});

describe('migrationStep', () => {
  it('reads ODRP002 CSV files through the reader', () => {
    const csv = (month: string, inM: number) =>
      `statistic_yyymm,site_id,village,in_total_m,in_total_f,out_total_m,out_total_f\n${month},臺北市萬華區,x,${inM},1,2,3\n`;
    const reader = new MemoryRawReader({
      'population/ris/ODRP002-10501.csv': csv('10501', 1),
      'population/ris/ODRP002-10502.csv': csv('10502', 2),
      'population/ris/ODRP002-10503.csv': csv('10503', 3),
    });
    const ctx: BuildContext = {
      reader,
      districts: DISTRICTS.filter((d) => d.code === A),
      quarters: ['2016Q1'],
      logger: memoryLogger(),
    };
    const state = createState();
    migrationStep().run(ctx, state);
    expect(state.moveIn?.[A]).toEqual([{ value: 9, estimated: false }]); // (1+1)+(2+1)+(3+1)
    expect(state.moveOut?.[A]).toEqual([{ value: 15, estimated: false }]); // 3 x (2+3)
  });
});
