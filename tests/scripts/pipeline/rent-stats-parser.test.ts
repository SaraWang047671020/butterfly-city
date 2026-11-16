import { describe, expect, it } from 'vitest';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseRentStats } from '../../../scripts/pipeline/parsers/rent-stats.ts';
import { makeOds } from '../helpers.ts';

const HEADER = ['編號', '縣市', '行政區', '房屋類型', '契約數', '租金25分位', '租金50分位', '租金75分位'];

const rows = [
  ['資料背景說明'],
  HEADER,
  ['1', '新北市', '板橋區', '不分類', '10,981', '9,000', '12,500', '17,500'],
  ['整戶(層)', '3,616', '12,000', '16,000', '22,000'],
  ['2', '臺北市', '士林區', '不分類', '6,311', '8,500', '12,000', '18,000'],
  ['3', '台北市', '大安區', '不分類', '5,000', '9,000', '14,000', '19,000'],
  ['4', '桃園市', '中壢區', '不分類', '19,977', '5,300', '7,200', '12,000'],
  ['新北市', '不分類', '85,521', '8,500', '12,500', '18,000', '12,923', '12,990', '-0.5%'],
];

describe('parseRentStats', () => {
  it('returns the P50 of the 不分類 row of each Taipei and New Taipei district', () => {
    expect(parseRentStats(makeOds(rows), 'rent.ods')).toEqual([
      { districtCode: '63000030', contracts: 5000, p50: 14000 },
      { districtCode: '63000110', contracts: 6311, p50: 12000 },
      { districtCode: '65000010', contracts: 10981, p50: 12500 },
    ]);
  });

  it('throws ParseError naming the header row and the missing column', () => {
    const header = HEADER.filter((h) => h !== '租金50分位');
    const err = (() => {
      try {
        parseRentStats(makeOds([['資料背景說明'], header, rows[2]!]), 'rent.ods');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.file).toBe('rent.ods');
    expect(err.row).toBe(2);
    expect(err.expected).toContain('租金50分位');
    expect(err.found).toEqual(header);
  });

  it('throws ParseError when there is no header row, the file is not an ODS or no district row exists', () => {
    expect(() => parseRentStats(makeOds([['x'], ['y']]), 'rent.ods')).toThrow(/no header row/);
    expect(() => parseRentStats(Buffer.from('not a zip'), 'rent.ods')).toThrow(ParseError);
    expect(() => parseRentStats(makeOds([HEADER, rows[4]!.map((c, i) => (i === 1 ? '桃園市' : c))]), 'rent.ods')).toThrow(/no district rows/);
  });

  it('throws ParseError for a bad P50 and for a duplicate district', () => {
    const bad = ['1', '新北市', '板橋區', '不分類', '10,981', '9,000', '-', '17,500'];
    expect(() => parseRentStats(makeOds([HEADER, bad]), 'rent.ods')).toThrow(/row 2.*租金50分位 is not a positive integer/);
    expect(() => parseRentStats(makeOds([HEADER, rows[2]!, rows[2]!]), 'rent.ods')).toThrow(/row 3.*duplicate/);
  });

  it('throws DataError for a Taipei or New Taipei row that matches no district', () => {
    const unknown = ['1', '新北市', '不明區', '不分類', '10', '1', '2', '3'];
    expect(() => parseRentStats(makeOds([HEADER, unknown]), 'rent.ods')).toThrow(DataError);
  });
});
