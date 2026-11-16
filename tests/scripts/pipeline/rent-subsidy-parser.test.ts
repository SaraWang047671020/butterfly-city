import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseE3010, parseRentAmount169800, rocQuarterToQuarter } from '../../../scripts/pipeline/parsers/rent-subsidy.ts';

const table = (rows: unknown[][]): string => JSON.stringify({ resultTable: rows });

describe('parseE3010', () => {
  it('maps ROC quarters, city labels and comma numbers', () => {
    const rows = parseE3010(
      table([
        ['縣市', '104Q1', '104Q2'],
        ['新北市', '4,213.00', '3,714.00'],
        ['台北市', '3,332.00', '0.00'],
      ]),
      'f.json',
    );
    expect(rows).toEqual([
      { city: 'New Taipei', quarter: '2015Q1', value: 4213 },
      { city: 'New Taipei', quarter: '2015Q2', value: 3714 },
      { city: 'Taipei', quarter: '2015Q1', value: 3332 },
      { city: 'Taipei', quarter: '2015Q2', value: 0 },
    ]);
  });

  it('omits a cell with no figure', () => {
    const rows = parseE3010(table([['縣市', '114Q3', '114Q4'], ['臺北市', '', '5']]), 'f.json');
    expect(rows).toEqual([{ city: 'Taipei', quarter: '2025Q4', value: 5 }]);
  });

  it('rejects an unknown city, a bad header and a non-numeric cell with the row', () => {
    expect(() => parseE3010(table([['縣市', '104Q1'], ['桃園市', '1']]), 'f.json')).toThrow(/row 2.*unknown city/);
    expect(() => parseE3010(table([['縣市', '2015Q1'], ['台北市', '1']]), 'f.json')).toThrow(ParseError);
    expect(() => parseE3010(table([['縣市', '104Q1'], ['台北市', 'abc']]), 'f.json')).toThrow(/row 2/);
  });

  it('throws ParseError when resultTable is missing', () => {
    expect(() => parseE3010('{"x":1}', 'f.json')).toThrow(ParseError);
    expect(() => parseE3010('not json', 'f.json')).toThrow(ParseError);
  });

  it('converts quarter cells', () => {
    expect(rocQuarterToQuarter('114Q4')).toBe('2025Q4');
    expect(rocQuarterToQuarter('x')).toBeUndefined();
  });
});

describe('parseRentAmount169800', () => {
  const header = '年,地區,租金補貼戶數計,租金補貼戶數男,租金補貼金額計';
  const csv = [
    header,
    '112,總計,"2,739,255","1,201,292","9,783,862.90"',
    '112,新北市,"528,603","238,664","1,928,531.40"',
    '112,臺北市,"354,515","156,044","1,665,725.70"',
    '112,桃園市,"392,603","173,590","1,441,289.30"',
  ].join('\n');

  it('returns the two cities with the year converted to Gregorian', () => {
    expect(parseRentAmount169800(csv, 'f.csv')).toEqual([
      { city: 'New Taipei', year: 2023, householdMonths: 528603, amountThousand: 1928531.4 },
      { city: 'Taipei', year: 2023, householdMonths: 354515, amountThousand: 1665725.7 },
    ]);
  });

  it('throws ParseError with row 1 for a missing column', () => {
    try {
      parseRentAmount169800('年,地區,租金補貼戶數計\n112,臺北市,1', 'f.csv');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).row).toBe(1);
      expect((e as ParseError).expected).toContain('租金補貼金額計');
    }
  });

  it('rejects a non-numeric amount with its row', () => {
    expect(() => parseRentAmount169800(`${header}\n112,臺北市,5,1,x`, 'f.csv')).toThrow(/row 2/);
  });
});
