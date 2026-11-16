import { describe, expect, it } from 'vitest';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  parseMigrationCsv,
  parseMigrationJson,
  parsePopulationCsv,
  parsePopulationJson,
} from '../../../scripts/pipeline/parsers/household.ts';

const POP_HEADER = 'statistic_yyymm,site_id,village,household_no,people_total,people_total_m,people_total_f';
const MIG_HEADER = 'statistic_yyymm,site_id,village,in_total_m,in_total_f,out_total_m,out_total_f';

describe('parsePopulationCsv (ODRP005 layout)', () => {
  const csv = [
    POP_HEADER,
    '10412,新北市板橋區,留侯里,691,1649,786,863',
    '10412,新北市板橋區,流芳里,638,1564,732,832',
    '10412,台北市松山區,莊敬里,100,300,150,150', // 台 variant
    '10412,桃園市桃園區,某里,10,50,25,25', // outside the two cities
    '10412,臺北市大安區,車層里,9,7,3,4',
  ].join('\n');

  it('keeps Taipei and New Taipei rows, maps names to codes and skips other counties', () => {
    expect(parsePopulationCsv(csv, 'pop.csv')).toEqual([
      { month: '10412', districtCode: '65000010', village: '留侯里', peopleTotal: 1649 },
      { month: '10412', districtCode: '65000010', village: '流芳里', peopleTotal: 1564 },
      { month: '10412', districtCode: '63000010', village: '莊敬里', peopleTotal: 300 },
      { month: '10412', districtCode: '63000030', village: '車層里', peopleTotal: 7 },
    ]);
  });

  it('throws DataError for a row inside the two cities that matches no district', () => {
    const bad = `${POP_HEADER}\n10412,新北市火星區,某里,1,5,2,3`;
    const err = (() => {
      try {
        parsePopulationCsv(bad, 'pop.csv');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).message).toContain('pop.csv row 2');
    expect((err as DataError).details.join(' ')).toContain('新北市火星區');
  });

  it('throws ParseError with row 1, expected and found columns when a column is missing', () => {
    const noPeople = 'statistic_yyymm,site_id,village,household_no\n10412,新北市板橋區,留侯里,691';
    const err = (() => {
      try {
        parsePopulationCsv(noPeople, 'pop.csv');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.file).toBe('pop.csv');
    expect(err.row).toBe(1);
    expect(err.expected).toContain('people_total');
    expect(err.found).toEqual(['statistic_yyymm', 'site_id', 'village', 'household_no']);
  });

  it('throws ParseError naming the row for a non-integer count', () => {
    const bad = `${POP_HEADER}\n10412,新北市板橋區,留侯里,691,12.5,1,1`;
    expect(() => parsePopulationCsv(bad, 'pop.csv')).toThrow(/pop\.csv row 2/);
  });
});

describe('parsePopulationJson (ris.gov.tw layout with district_code)', () => {
  it('uses the first 8 digits of district_code and skips other counties', () => {
    const json = JSON.stringify([
      { statistic_yyymm: '10801', district_code: '63000010002', site_id: '臺北市松山區', village: '莊敬里', people_total: '100' },
      { statistic_yyymm: '10801', district_code: '65000290001', site_id: '新北市烏來區', village: '烏來里', people_total: '2000' },
      { statistic_yyymm: '10801', district_code: '68000010001', site_id: '桃園市桃園區', village: '某里', people_total: '5' },
    ]);
    expect(parsePopulationJson(json, 'pop.json')).toEqual([
      { month: '10801', districtCode: '63000010', village: '莊敬里', peopleTotal: 100 },
      { month: '10801', districtCode: '65000290', village: '烏來里', peopleTotal: 2000 },
    ]);
  });

  it('reads real-shaped ODRP014 rows (household, sex and single-age columns present)', () => {
    const json = JSON.stringify([
      {
        statistic_yyymm: '10703', district_code: '63000010002', site_id: '臺北市松山區', village: '莊敬里',
        household_no: '2080', people_total: '5531', people_total_m: '2666', people_total_f: '2865',
        people_age_000_m: '25', people_age_000_f: '20', people_age_100up_m: '0', people_age_100up_f: '1',
      },
      {
        statistic_yyymm: '10703', district_code: '65000010001', site_id: '新北市板橋區', village: '留侯里',
        household_no: '691', people_total: '1649', people_total_m: '786', people_total_f: '863',
        people_age_000_m: '9', people_age_000_f: '7', people_age_100up_m: '0', people_age_100up_f: '0',
      },
    ]);
    expect(parsePopulationJson(json, 'ODRP014-10703-臺北市.json')).toEqual([
      { month: '10703', districtCode: '63000010', village: '莊敬里', peopleTotal: 5531 },
      { month: '10703', districtCode: '65000010', village: '留侯里', peopleTotal: 1649 },
    ]);
  });

  it('rejects the births/deaths layout of ODRP010/ODRP060, which has no people_total', () => {
    const vital = JSON.stringify([
      { statistic_yyymm: '10801', district_code: '63000010002', site_id: '臺北市松山區', village: '莊敬里', birth_total: '5' },
    ]);
    expect(() => parsePopulationJson(vital, 'vital.json')).toThrow(ParseError);
  });
});

describe('parseMigrationCsv and parseMigrationJson', () => {
  it('reads ODRP002 CSV rows by site_id and keeps male and female in/out counts', () => {
    const csv = [
      MIG_HEADER,
      '10512,新北市板橋區,留侯里,3,1,1,0',
      '10512,臺北市萬華區,某里,5,6,7,8',
      '10512,基隆市仁愛區,某里,9,9,9,9',
    ].join('\n');
    expect(parseMigrationCsv(csv, 'mig.csv')).toEqual([
      { month: '10512', districtCode: '65000010', village: '留侯里', inMale: 3, inFemale: 1, outMale: 1, outFemale: 0 },
      { month: '10512', districtCode: '63000070', village: '某里', inMale: 5, inFemale: 6, outMale: 7, outFemale: 8 },
    ]);
  });

  it('reads the Chinese-header CSV (ODRP011-11308) with 區域別代碼', () => {
    const csv = [
      '統計年月,區域別代碼,區域別,村里名稱,遷入人數_合計_男,遷入人數_合計_女,遷出人數_合計_男,遷出人數_合計_女',
      '11308,65000010001,新北市板橋區,留侯里,3,0,2,1',
      '11308,65000010002,新北市板橋區,流芳里,2,3,0,4',
    ].join('\n');
    const rows = parseMigrationCsv(csv, 'mig-zh.csv');
    expect(rows.map((r) => r.inMale + r.inFemale)).toEqual([3, 5]);
    expect(rows.map((r) => r.outMale + r.outFemale)).toEqual([3, 4]);
    expect(new Set(rows.map((r) => r.districtCode))).toEqual(new Set(['65000010']));
  });

  it('reads ODRP011 JSON with district_code', () => {
    const json = JSON.stringify([
      { statistic_yyymm: '10801', district_code: '65000010001', site_id: '新北市板橋區', village: '留侯里', in_total_m: '7', in_total_f: '4', out_total_m: '1', out_total_f: '0', in_foreign_m: '1' },
    ]);
    expect(parseMigrationJson(json, 'mig.json')).toEqual([
      { month: '10801', districtCode: '65000010', village: '留侯里', inMale: 7, inFemale: 4, outMale: 1, outFemale: 0 },
    ]);
  });

  it('throws ParseError with row 1, expected and found columns when out_total_f is missing', () => {
    const csv = 'statistic_yyymm,site_id,village,in_total_m,in_total_f,out_total_m\n10512,新北市板橋區,留侯里,3,1,1';
    const err = (() => {
      try {
        parseMigrationCsv(csv, 'mig.csv');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.row).toBe(1);
    expect(err.expected.join(' ')).toContain('out_total_f');
    expect(err.found).toContain('out_total_m');
    expect(err.found).not.toContain('out_total_f');
  });
});
