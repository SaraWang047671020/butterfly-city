import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../../scripts/lib/districts.ts';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';
import {
  checkQuartiles,
  commuteGhostParams,
  parseCensusWorkplaceRows,
  rentGhostParams,
  type RentGhostDistrictInput,
  type WorkplaceRow,
} from '../../../../scripts/pipeline/params/ghost.ts';
import { parseFiaQuartiles } from '../../../../scripts/pipeline/parsers/income.ts';

// ---- FIA quartiles -----------------------------------------------------------------------
const FIA_HEADER = '縣市別,村里,中位數,第一分位數,第三分位數';

describe('parseFiaQuartiles', () => {
  it('reads Q1 and Q3 of the district total rows only', () => {
    const csv = [
      FIA_HEADER,
      '臺北市松山區,合計,700,400,900',
      '臺北市松山區,東勢里,650,300,800',
      '新北市板橋區,合計,600,500,500',
      '桃園市中壢區,合計,600,100,200',
    ].join('\n');
    expect(parseFiaQuartiles(csv, '112_165-9.csv', 2023)).toEqual([
      { districtCode: '63000010', incomeYear: 2023, q1: 400, q3: 900 },
      { districtCode: '65000010', incomeYear: 2023, q1: 500, q3: 500 }, // order is checked by ghost.ts
    ]);
  });

  it('accepts the older 鄉鎮市區 column name', () => {
    const csv = ['鄉鎮市區,村里,第一分位數,第三分位數', '臺北市大安區,合計,10,20'].join('\n');
    expect(parseFiaQuartiles(csv, '109_165-9.csv', 2020)).toHaveLength(1);
  });

  it('rejects a file without the 第三分位數 column', () => {
    const csv = ['縣市別,村里,第一分位數', '臺北市松山區,合計,400'].join('\n');
    expect(() => parseFiaQuartiles(csv, '112_165-9.csv', 2023)).toThrow(ParseError);
    expect(() => parseFiaQuartiles(csv, '112_165-9.csv', 2023)).toThrow(/missing required column 第三分位數/);
  });

  it('rejects a quartile that is not a number', () => {
    const csv = [FIA_HEADER, '臺北市松山區,合計,700,abc,900'].join('\n');
    expect(() => parseFiaQuartiles(csv, '112_165-9.csv', 2023)).toThrow(/第一分位數 is not a number/);
  });
});

// ---- rent ghost --------------------------------------------------------------------------
/** Income 72000 = 1200 x (rent 100 x size 30) / threshold 50, so the tail at 50 percent is Phi(0) = 0.5. */
const district = (code: string, city: 'Taipei' | 'New Taipei', q1 = 1, q3 = 4): RentGhostDistrictInput => ({
  districtCode: code, city, householdIncome: [72000, 72000, 72000, 72000], rent: [100, 100, 100, 100], population: 1000, q1, q3,
});
const all = (override?: (d: RentGhostDistrictInput) => RentGhostDistrictInput) =>
  DISTRICTS.map((d) => (override ?? ((x) => x))(district(d.code, d.city)));
const base = { dwellingSize: 30, renterRate: { Taipei: 0.4, 'New Taipei': 0.4 }, rentThreshold: 50 };

describe('rentGhostParams', () => {
  it('gives shareRent = renter rate x 0.5 when the median income sits on the threshold', () => {
    const r = rentGhostParams({ ...base, districts: all() });
    expect(r.shareRent.value).toBeCloseTo(0.2, 7); // normalCdf is an approximation (error about 2e-10)
    expect(r.sensitivityRent.value).toBeGreaterThan(0);
    expect(r.shareRent.status).toBe('secondary');
  });

  it('stops for a district with Q1 not below Q3', () => {
    const districts = all((d) => (d.districtCode === '65000010' ? { ...d, q1: 900, q3: 400 } : d));
    expect(() => rentGhostParams({ ...base, districts })).toThrow(/fia-quartiles-invalid: 65000010/);
    expect(() => checkQuartiles('x', 5, 5)).toThrow(DataError);
    expect(() => checkQuartiles('x', 0, 5)).toThrow(DataError);
    expect(() => checkQuartiles('x', 1, 5)).not.toThrow();
  });

  it('stops when a district is missing', () => {
    expect(() => rentGhostParams({ ...base, districts: all().slice(1) })).toThrow(/ghost-rent-districts/);
  });
});

// ---- table 14 and commute shares ---------------------------------------------------------
const names = (city: string) => DISTRICTS.filter((d) => d.city === city).map((d) => d.zh.slice(3));

describe('parseCensusWorkplaceRows', () => {
  const rows = (): string[][] => [
    ['居住地', '總計', '同一鄉鎮市區', '同縣市他鄉鎮', '外縣市或國外'],
    ...names('Taipei').map((n) => [n, '10', '6', '3', '1']),
    ...names('Taipei').map((n) => [n, '5', '5', '0', '0']), // later block (by sex) is ignored
  ];

  it('keeps the first block of each district', () => {
    const w = parseCensusWorkplaceRows(rows(), 'w.ods', 'Taipei');
    expect(w.districts.size).toBe(12);
    expect(w.districts.get('63000010')).toEqual({ total: 10, sameDistrict: 6, otherDistrictSameCity: 3, otherCountyOrAbroad: 1 });
    expect(w.totals.total).toBe(120);
  });

  it('rejects a row with a missing column', () => {
    const bad = rows();
    bad[1] = [names('Taipei')[0]!, '10', '6', '3'];
    expect(() => parseCensusWorkplaceRows(bad, 'w.ods', 'Taipei')).toThrow(/workplace-row-invalid/);
  });

  it('rejects categories that do not add up', () => {
    const bad = rows();
    bad[1] = [names('Taipei')[0]!, '10', '6', '3', '2'];
    expect(() => parseCensusWorkplaceRows(bad, 'w.ods', 'Taipei')).toThrow(/workplace-row-total/);
  });
});

describe('commuteGhostParams on a 3-district fixture', () => {
  const codes = DISTRICTS.map((d) => d.code);
  const minutes = (cross: number) =>
    codes.map((a, i) => codes.map((b, j) => (i === j ? 0 : a.slice(0, 2) === b.slice(0, 2) ? 30 : cross)));
  const row = (total: number, same: number, other: number, county: number): WorkplaceRow => ({
    total, sameDistrict: same, otherDistrictSameCity: other, otherCountyOrAbroad: county,
  });
  const workplace = [
    { city: 'Taipei' as const, districts: new Map([['63000010', row(100, 40, 40, 20)], ['63000020', row(50, 50, 0, 0)]]), totals: row(150, 90, 40, 20) },
    { city: 'New Taipei' as const, districts: new Map([['65000010', row(100, 10, 30, 60)]]), totals: row(100, 10, 30, 60) },
  ];
  const jobShare = new Map(codes.map((c) => [c, 1 / 41]));

  it('counts 170 of 250 within 45 minutes, and all 250 within 60 when cross-city trips take 60', () => {
    const r = commuteGhostParams({ workplace, jobShare, matrix: { codes, minutes: minutes(60) } });
    expect(r.within45).toBeCloseTo(0.68, 10);
    expect(r.within60).toBeCloseTo(1, 10);
    expect(r.shareCommuteWithin.value).toBeCloseTo(1, 10);
    expect(r.shareCommuteWithin.range?.low).toBeCloseTo(0.68, 10);
    expect(r.sensitivityCommute.value).toBeCloseTo(0.32, 10); // 80 cross-city workers sit in the 59 to 60 minute band
  });

  it('counts only same-city trips when cross-city trips take 70 minutes', () => {
    const r = commuteGhostParams({ workplace, jobShare, matrix: { codes, minutes: minutes(70) } });
    expect(r.within60).toBeCloseTo(0.68, 10);
    expect(r.sensitivityCommute.value).toBeCloseTo(0, 10);
  });

  it('stops when a job share is missing', () => {
    const short = new Map(jobShare);
    short.delete('63000020');
    expect(() => commuteGhostParams({ workplace, jobShare: short, matrix: { codes, minutes: minutes(60) } })).toThrow(/ghost-commute-jobshare/);
  });
});
