import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { memoryLogger, type BuildContext } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import {
  buildIncome,
  buildIncomeUnrounded,
  fiaFiles,
  incomeStep,
  relativeIncomeByYear,
} from '../../../scripts/pipeline/indicators/income.ts';
import { roundTo } from '../../../scripts/pipeline/numeric.ts';
import type { DgbasCityIncomeRow, FiaDistrictRow } from '../../../scripts/pipeline/parsers/income.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

// Small hand-made world: Taipei has A, B, C; New Taipei has D, E.
const districts = [
  { code: 'A', city: 'Taipei' as const },
  { code: 'B', city: 'Taipei' as const },
  { code: 'C', city: 'Taipei' as const },
  { code: 'D', city: 'New Taipei' as const },
  { code: 'E', city: 'New Taipei' as const },
];
const quarters = quartersBetween();

/** A grows by 10 per year from 100 (2014); B = 200 and C = 300 stay fixed; D = 100 and E = 300. */
function medianOf(code: string, year: number): number {
  return { A: 100 + 10 * (year - 2014), B: 200, C: 300, D: 100, E: 300 }[code as 'A'];
}

function fia(scale = 1): Map<number, FiaDistrictRow[]> {
  const out = new Map<number, FiaDistrictRow[]>();
  for (let y = 2014; y <= 2023; y++) {
    out.set(
      y,
      districts.map((d) => ({ districtCode: d.code, incomeYear: y, households: 1000, median: medianOf(d.code, y) * scale })),
    );
  }
  return out;
}

function dgbas(): DgbasCityIncomeRow[] {
  const rows: DgbasCityIncomeRow[] = [];
  for (let y = 2010; y <= 2026; y++) {
    rows.push({ year: y, taipei: 1_000_000 + 10_000 * (y - 2014), newTaipei: 800_000 });
  }
  return rows;
}

describe('relative median income per FIA year', () => {
  it('divides each median by the median of the district medians of its city', () => {
    const rel = relativeIncomeByYear(fia(), districts);
    expect(rel.get('B')!.get(2016)).toBe(1);
    expect(rel.get('C')!.get(2016)).toBe(1.5);
    expect(rel.get('A')!.get(2014)).toBe(0.5);
    expect(rel.get('A')!.get(2019)).toBe(0.75);
    // New Taipei: median of (100, 300) is 200
    expect(rel.get('D')!.get(2020)).toBe(0.5);
    expect(rel.get('E')!.get(2020)).toBe(1.5);
  });

  it('is unchanged when all medians of every file are scaled by the same factor', () => {
    const a = relativeIncomeByYear(fia(), districts);
    const b = relativeIncomeByYear(fia(7), districts);
    for (const [code, years] of a) for (const [y, v] of years) expect(b.get(code)!.get(y)).toBeCloseTo(v, 12);
  });

  it('names the district and the year when a total row is missing', () => {
    const rows = fia();
    rows.set(2017, rows.get(2017)!.filter((r) => r.districtCode !== 'C'));
    try {
      relativeIncomeByYear(rows, districts);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).message).toContain('missing-district-income');
      expect((e as DataError).details.join('\n')).toMatch(/district C income year 2017/);
    }
  });

  it('rejects a median that is not greater than 0', () => {
    const rows = fia();
    rows.set(2020, rows.get(2020)!.map((r) => (r.districtCode === 'D' ? { ...r, median: 0 } : r)));
    expect(() => relativeIncomeByYear(rows, districts)).toThrow(/non-positive-median/);
  });

  it('rejects a missing income year', () => {
    const rows = fia();
    rows.delete(2014);
    expect(() => relativeIncomeByYear(rows, districts)).toThrow(/missing-fia-year/);
  });
});

describe('buildIncome', () => {
  const u = buildIncomeUnrounded(fia(), dgbas(), districts, quarters);

  it('extrapolates 2024 and 2025 from the line through 2019..2023', () => {
    // A: rel 0.75, 0.80, 0.85, 0.90, 0.95 -> slope 0.05 per year -> 1.00 (2024), 1.05 (2025)
    // 2025 is the last year, so its quarters are flat at 1.05; 2024 uses the minmod slope 0.05.
    expect(u.relative.get('A')!.get('2025Q1')).toBeCloseTo(1.05, 12);
    expect(u.relative.get('A')!.get('2025Q4')).toBeCloseTo(1.05, 12);
    expect(u.relative.get('A')!.get('2024Q1')).toBeCloseTo(1.0 - 0.05 * (3 / 8), 12);
    // constant series stay constant
    expect(u.relative.get('B')!.get('2024Q3')).toBeCloseTo(1, 12);
  });

  it('does not let 2014..2018 inputs change the extrapolated years', () => {
    const changed = fia();
    changed.set(2015, changed.get(2015)!.map((r) => (r.districtCode === 'A' ? { ...r, median: 150 } : r)));
    const v = buildIncomeUnrounded(changed, dgbas(), districts, quarters);
    expect(v.relative.get('A')!.get('2025Q2')).toBe(u.relative.get('A')!.get('2025Q2'));
    expect(v.relative.get('A')!.get('2024Q4')).toBe(u.relative.get('A')!.get('2024Q4'));
  });

  it('interpolates the city series mean-preserving, using the 2014 neighbour for 2015', () => {
    // Taipei is linear at +10000 per year: 2015 = 1,010,000 with slope 10,000
    const q = (['2015Q1', '2015Q2', '2015Q3', '2015Q4'] as Quarter[]).map((x) => u.city.get('Taipei')!.get(x)!);
    expect(q[0]).toBeCloseTo(1_010_000 - 10_000 * (3 / 8), 6);
    expect(q.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1_010_000, 6);
    expect(u.city.get('New Taipei')!.get('2020Q2')).toBe(800_000);
  });

  it('computes household income from unrounded values and rounds once', () => {
    const s = buildIncome(fia(), dgbas(), districts, quarters);
    // A in 2025 Q1: city 1,110,000 (last year, flat) x 1.05 = 1,165,500
    expect(s.householdIncome.A![40]).toEqual({ value: 1_165_500, estimated: true, method: 'income-district-combination' });
    const i = 7; // 2016Q4
    const exact = u.city.get('Taipei')!.get(quarters[i]!)! * u.relative.get('A')!.get(quarters[i]!)!;
    expect(s.householdIncome.A![i]!.value).toBe(roundTo(exact, 0));
    expect(s.relativeMedianIncome.A![i]!.value).toBe(roundTo(u.relative.get('A')!.get(quarters[i]!)!, 4));
  });

  it('flags every record as estimated with the method ids of the design', () => {
    const s = buildIncome(fia(), dgbas(), districts, quarters);
    expect(s.cityDisposableIncome.Taipei).toHaveLength(44);
    expect(s.cityDisposableIncome['New Taipei'].every((r) => r.estimated && r.method === 'interp-annual-quarterly')).toBe(true);
    expect(s.householdIncome.D).toHaveLength(44);
    expect(s.householdIncome.D!.every((r) => r.estimated && r.method === 'income-district-combination')).toBe(true);
    const rel = s.relativeMedianIncome.A!;
    expect(rel.slice(0, 36).every((r) => r.estimated && r.method === 'interp-annual-quarterly')).toBe(true);
    expect(rel.slice(36).every((r) => r.estimated && r.method === 'income-relative-extrapolation')).toBe(true);
  });

  it('names the city and year when the DGBAS series lacks a year', () => {
    const rows = dgbas().filter((r) => r.year !== 2020);
    try {
      buildIncome(fia(), rows, districts, quarters);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).message).toContain('missing-dgbas-year');
      expect((e as DataError).message).toContain('Taipei 2020');
      expect((e as DataError).message).toContain('New Taipei 2020');
    }
  });

  it('tolerates a DGBAS series that starts in 2015 (no 2014 neighbour)', () => {
    const rows = dgbas().filter((r) => r.year >= 2015);
    const s = buildIncome(fia(), rows, districts, quarters);
    expect(s.cityDisposableIncome.Taipei[0]!.value).toBe(1_010_000);
  });
});

describe('incomeStep', () => {
  it('reads the ten FIA files and the DGBAS file through the reader and fills the state', () => {
    const files: Record<string, string> = {};
    for (const f of fiaFiles()) {
      const lines = ['鄉鎮市區,村里,納稅單位(戶),中位數'];
      DISTRICTS.forEach((d, i) => lines.push(`${d.zh},合計,1000,${(i + 1) * 10}`, `${d.zh},某里,5,9999`));
      files[f.path] = lines.join('\n');
    }
    expect(fiaFiles()[0]).toEqual({ path: 'income/103_165-9.csv', incomeYear: 2014 });
    expect(fiaFiles()[9]).toEqual({ path: 'income/112_165-9.csv', incomeYear: 2023 });
    const dg = ['年,臺北市-元,新北市-元'];
    for (let y = 1998; y <= 2025; y++) dg.push(`${y},1000000,800000`);
    files['income/dgbas-9415-disposable-income-by-region.csv'] = dg.join('\n');
    const ctx: BuildContext = {
      reader: new MemoryRawReader(files),
      districts: DISTRICTS,
      quarters,
      logger: memoryLogger(),
    };
    const state = createState();
    incomeStep().run(ctx, state);
    expect(state.cityDisposableIncome!.Taipei).toHaveLength(44);
    expect(state.relativeMedianIncome![DISTRICTS[0]!.code]).toHaveLength(44);
    expect(Object.keys(state.householdIncome!)).toHaveLength(41);
    // constant series: household = city income x relative income
    const first = DISTRICTS[0]!;
    const hh = state.householdIncome![first.code]![0]!.value as number;
    expect(Math.abs(hh - 1_000_000 * (state.relativeMedianIncome![first.code]![0]!.value as number))).toBeLessThanOrEqual(50);
  });
});
