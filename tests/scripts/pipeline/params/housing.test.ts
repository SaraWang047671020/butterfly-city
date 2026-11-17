import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../../scripts/lib/districts.ts';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';
import {
  buildHousingParams,
  parseHouseholdTotals,
  rentCrossCheck,
} from '../../../../scripts/pipeline/params/housing.ts';
import { parseCensusTenureRows, type CityTenure } from '../../../../scripts/pipeline/parsers/census-tenure.ts';
import { parseRentalExtras, splitWholeDwellings, type RentalRecord } from '../../../../scripts/pipeline/parsers/lvr-rental-extra.ts';

const HEADER_ZH = '鄉鎮市區,交易標的,租賃年月日,主要用途,總額元,單價元平方公尺,建物總面積平方公尺,編號,出租型態,租賃筆棟數';
const HEADER_EN = 'district,target,date,use,rent,unit,area,serial,type,counts';
const line = (id: string, target: string, type: string, counts: string, rent: number, area: number): string =>
  `大安區,${target},1130515,住家用,${rent},${rent / area},${area},${id},${type},${counts}`;
const HOUSE = '房地(土地+建物)';
const NO_PARKING = '土地0建物1車位0';

describe('dwellingSize whole-dwelling filter', () => {
  const csv = [
    HEADER_ZH,
    HEADER_EN,
    line('a1', HOUSE, '', NO_PARKING, 30000, 30), // blank type: kept
    line('a2', HOUSE, '整棟(戶)出租', NO_PARKING, 50000, 50), // kept
    line('a3', HOUSE, '獨立套房', NO_PARKING, 10000, 10),
    line('a4', HOUSE, '分租雅房', NO_PARKING, 8000, 8),
    line('a5', HOUSE, '', '土地0建物1車位1', 40000, 40), // parking count above 0
    line('a6', '房地(土地+建物)+車位', '', NO_PARKING, 40000, 40), // target names parking
    line('a7', HOUSE, '其他', NO_PARKING, 20000, 20), // unknown type
    line('a8', HOUSE, '分層出租', NO_PARKING, 12000, 12),
    line('a9', HOUSE, '', NO_PARKING, 70000, 70), // zero parking: kept
    line('a10', HOUSE, '分租套房', '土地0建物1車位1', 9000, 9), // parking is checked first
  ].join('\n');
  const records = parseRentalExtras(csv, '114S1_a_lvr_land_c.csv');

  it('parses the extra fields', () => {
    expect(records).toHaveLength(10);
    expect(records[2]).toMatchObject({ id: 'a3', rentType: '獨立套房', hasParking: false });
    expect(records[4]).toMatchObject({ id: 'a5', hasParking: true });
    expect(records[5]).toMatchObject({ id: 'a6', hasParking: true });
  });

  it('keeps blank and whole-dwelling types and excludes parking, suites and rooms', () => {
    const s = splitWholeDwellings(records);
    expect(s.qualifying).toHaveLength(10);
    expect(s.kept.map((r) => r.id)).toEqual(['a1', 'a2', 'a9']);
    expect(s.excluded).toEqual({ parking: 3, 'suite-or-room': 3, 'other-type': 1 });
  });

  it('rejects a file without the 租賃年月日 column', () => {
    const bad = csv.replace('租賃年月日', 'x');
    expect(() => parseRentalExtras(bad, '114S1_a_lvr_land_c.csv')).toThrow(ParseError);
  });
});

const rec = (code: string, rent: number, area: number, extra: Partial<RentalRecord> = {}): RentalRecord => ({
  id: '', kind: 'rental', districtCode: code, quarter: '2024Q2', target: HOUSE, use: '住家用',
  unitPrice: rent / area, totalPrice: 0, rent, area, rentType: '', hasParking: false, ...extra,
});

const rentals: RentalRecord[] = [
  rec('63000030', 30000, 30), rec('63000030', 50000, 50), rec('63000030', 90000, 45), rec('63000040', 40000, 40),
  rec('65000010', 20000, 20), rec('65000010', 40000, 40),
  rec('65000010', 99999, 99, { hasParking: true }),
];

describe('rent cross-check', () => {
  it('weights district median rent per m² by record count', () => {
    const kept = splitWholeDwellings(rentals).kept;
    const c = rentCrossCheck(kept, 50);
    expect(c.Taipei.records).toBe(4);
    expect(c.Taipei.areaBasedRent).toBe(50000);
    expect(c.Taipei.medianTotalRent).toBe(45000);
    expect(c.Taipei.gapPercent).toBeCloseTo(11.1111111, 5);
    expect(c['New Taipei'].areaBasedRent).toBe(50000);
    expect(c['New Taipei'].medianTotalRent).toBe(30000);
    expect(c['New Taipei'].gapPercent).toBeCloseTo(66.6666667, 5);
  });
});

// ---- table 34 ----------------------------------------------------------------------------
const taipeiNames = DISTRICTS.filter((d) => d.city === 'Taipei').map((d) => d.zh.slice(3));
const tenureRows = (): string[][] => [
  ['項目', '總計', '自有', '親友所有', '租用', '配住或其他'],
  ['臺北市', '1 200', '480', '240', '360', '120'],
  ...taipeiNames.map((n) => [n, '100', '40', '20', '30', '10', 'English']),
];

describe('census tenure parser', () => {
  it('reads households and renting households, with spaces as thousands separators', () => {
    const t = parseCensusTenureRows(tenureRows(), 't.ods', 'Taipei');
    expect(t.total).toEqual({ households: 1200, renting: 360 });
    expect(t.districts.size).toBe(12);
    expect(t.districts.get('63000010')).toEqual({ households: 100, renting: 30 });
  });

  it('rejects a sheet without the 租用 header cell', () => {
    const rows = tenureRows();
    rows[0] = ['項目', '總計', '自有', '親友所有', '出租', '其他'];
    expect(() => parseCensusTenureRows(rows, 't.ods', 'Taipei')).toThrow(ParseError);
    expect(() => parseCensusTenureRows(rows, 't.ods', 'Taipei')).toThrow(/no header cell 租用/);
  });

  it('rejects a row whose categories do not add up and a city total that does not match', () => {
    const bad = tenureRows();
    bad[2] = [taipeiNames[0]!, '100', '40', '20', '31', '10'];
    expect(() => parseCensusTenureRows(bad, 't.ods', 'Taipei')).toThrow(/tenure row total mismatch/);
    const off = tenureRows();
    off[1] = ['臺北市', '1 300', '480', '240', '460', '120'];
    expect(() => parseCensusTenureRows(off, 't.ods', 'Taipei')).toThrow(/tenure city total mismatch/);
  });
});

// ---- ODRP014 -----------------------------------------------------------------------------
const odrp = (rows: object[]): string => JSON.stringify(rows);
const village = (code: string, h: string, p: string, month = '10912') => ({ statistic_yyymm: month, district_code: code, household_no: h, people_total: p });

describe('household size (ODRP014)', () => {
  it('sums households and people of the city villages', () => {
    const t = parseHouseholdTotals(odrp([village('63000010001', '10', '25'), village('63000020002', '30', '75')]), 'x.json', 'Taipei');
    expect(t).toEqual({ households: 40, people: 100 });
  });

  it('rejects a missing column, another month and another city', () => {
    const noPeople = [{ statistic_yyymm: '10912', district_code: '63000010001', household_no: '1' }];
    expect(() => parseHouseholdTotals(odrp(noPeople), 'x.json', 'Taipei')).toThrow(ParseError);
    expect(() => parseHouseholdTotals(odrp([village('63000010001', '1', '2', '10911')]), 'x.json', 'Taipei')).toThrow(/expected month/);
    expect(() => parseHouseholdTotals(odrp([village('65000010001', '1', '2')]), 'x.json', 'Taipei')).toThrow(DataError);
  });
});

// ---- builder -----------------------------------------------------------------------------
describe('buildHousingParams', () => {
  const tenure = (city: 'Taipei' | 'New Taipei'): CityTenure => ({
    city, total: { households: 1000, renting: 400 }, districts: new Map(),
  });

  it('builds the five entries with literal values', () => {
    const r = buildHousingParams({
      rentals,
      householdTotals: { Taipei: { households: 1000, people: 2500 }, 'New Taipei': { households: 2000, people: 5200 } },
      tenure: { Taipei: tenure('Taipei'), 'New Taipei': tenure('New Taipei') },
    });
    expect([...r.entries.keys()]).toEqual([
      'housing.dwellingSize', 'housing.householdSize.Taipei', 'housing.renterRate.Taipei',
      'housing.householdSize.New Taipei', 'housing.renterRate.New Taipei',
    ]);
    expect(r.entries.get('housing.dwellingSize')?.value).toBe(40); // areas 20 30 40 40 45 50
    expect(r.entries.get('housing.householdSize.Taipei')?.value).toBe(2.5);
    expect(r.entries.get('housing.householdSize.New Taipei')?.value).toBe(2.6);
    expect(r.entries.get('housing.renterRate.Taipei')?.value).toBe(0.4);
    expect(r.counts.rentalFilter).toMatchObject({ qualifying: 7, kept: 6 });
    expect(r.counts.rentalFilter.excluded.parking).toBe(1);
  });

  it('stops when no record qualifies', () => {
    expect(() => buildHousingParams({ rentals: [], householdTotals: {} as never, tenure: {} as never })).toThrow(/no qualifying rental records/);
  });
});
