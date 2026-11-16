import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseDgbasDisposableIncome, parseFiaDistrictTotals } from '../../../scripts/pipeline/parsers/income.ts';

const FIA_TAIL = '納稅單位(戶),綜合所得總額,平均數,中位數,第一分位數,第三分位數,標準差,變異係數';

describe('parseFiaDistrictTotals', () => {
  const body = [
    '"臺北市松山區","中崙里","1464","2745453","1875","857","386","2006","7449.22","397.23"',
    '"臺北市松山區","合計","69735","108655620","1558","758","330","1677","30310.73","1945.34"',
    '"新北市板橋區","合計","1,000","1","1","612","1","1","1","1"',
    '"桃園市桃園區","合計","5","1","1","700","1","1","1","1"',
    '"新北市板橋區","文化里","10","1","1","999","1","1","1","1"',
  ].join('\n');

  it('keeps only the total rows of the 41 districts (ROC 103 header)', () => {
    const rows = parseFiaDistrictTotals(`鄉鎮市區,村里,${FIA_TAIL}\n${body}\n`, 'f.csv', 2014);
    expect(rows).toEqual([
      { districtCode: '63000010', incomeYear: 2014, households: 69735, median: 758 },
      { districtCode: '65000010', incomeYear: 2014, households: 1000, median: 612 },
    ]);
  });

  it('accepts the 縣市別 first column used from ROC 110 and a BOM', () => {
    const rows = parseFiaDistrictTotals(`\uFEFF"縣市別","村里",${FIA_TAIL}\r\n${body}\r\n`, 'f.csv', 2021);
    expect(rows.map((r) => r.median)).toEqual([758, 612]);
  });

  it('throws ParseError with row 1 when 中位數 is missing', () => {
    const csv = `鄉鎮市區,村里,納稅單位(戶),平均數\n${body}\n`;
    try {
      parseFiaDistrictTotals(csv, 'f.csv', 2014);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const err = e as ParseError;
      expect(err.file).toBe('f.csv');
      expect(err.row).toBe(1);
      expect(err.expected).toContain('中位數');
      expect(err.found).toContain('平均數');
    }
  });

  it('throws ParseError with the row number for a non-numeric median', () => {
    const csv = `鄉鎮市區,村里,${FIA_TAIL}\n"臺北市松山區","合計","10","1","1","x","1","1","1","1"\n`;
    expect(() => parseFiaDistrictTotals(csv, 'f.csv', 2014)).toThrow(/row 2/);
  });
});

describe('parseDgbasDisposableIncome', () => {
  const csv = [
    '"年","臺灣地區-元","新北市-元","臺北市-元"',
    '"1998","873175","875751","1196141"',
    '"1999","889053","892692","1208578"',
    '',
  ].join('\n');

  it('returns one row per year with both city columns, whatever their order', () => {
    expect(parseDgbasDisposableIncome(csv, 'd.csv')).toEqual([
      { year: 1998, taipei: 1196141, newTaipei: 875751 },
      { year: 1999, taipei: 1208578, newTaipei: 892692 },
    ]);
  });

  it('throws ParseError with row 1 when a city column is missing', () => {
    const bad = '"年","臺北市-元"\n"1998","1196141"\n';
    try {
      parseDgbasDisposableIncome(bad, 'd.csv');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const err = e as ParseError;
      expect(err.row).toBe(1);
      expect(err.expected).toEqual(['年', '臺北市-元', '新北市-元']);
      expect(err.found).toEqual(['年', '臺北市-元']);
    }
  });

  it('throws ParseError for a malformed year or value', () => {
    expect(() => parseDgbasDisposableIncome('"年","臺北市-元","新北市-元"\n"98","1","2"\n', 'd.csv')).toThrow(ParseError);
    expect(() => parseDgbasDisposableIncome('"年","臺北市-元","新北市-元"\n"1998","","2"\n', 'd.csv')).toThrow(/row 2/);
  });
});
