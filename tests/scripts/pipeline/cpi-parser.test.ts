import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseDgbasCpiRent, parseTaipeiCpiRent } from '../../../scripts/pipeline/parsers/cpi.ts';

const HEADER = '"統計期","基本分類","原始值[統計數值]","年增率[%]","縣市別代碼"';

describe('parseTaipeiCpiRent', () => {
  const csv = [
    HEADER,
    '"103年 1月","總指數",94.52,1.67,63000',
    '"103年 2月","(一)房租",94.48,0.65,63000',
    '"103年 1月","(一)房租",94.46,0.71,63000',
    '"103年 1月","(一)房租",99.99,0.71,65000',
    '"115年 10月","(一)房租",108.28,1.50,63000',
    '',
  ].join('\n');

  it('returns the Taipei rent rows as sorted Gregorian months', () => {
    expect(parseTaipeiCpiRent(csv, 'cpi.csv')).toEqual([
      { yearMonth: '2014-01', value: 94.46 },
      { yearMonth: '2014-02', value: 94.48 },
      { yearMonth: '2026-10', value: 108.28 },
    ]);
  });

  it('accepts a BOM and the plain 房租 label', () => {
    const text = `\uFEFF${HEADER}\r\n"104年 12月","房租",100.5,1,63000\r\n`;
    expect(parseTaipeiCpiRent(text, 'cpi.csv')).toEqual([{ yearMonth: '2015-12', value: 100.5 }]);
  });

  it('throws ParseError naming the file, row 1 and the missing column', () => {
    const text = '"統計期","基本分類","年增率[%]","縣市別代碼"\n"103年 1月","(一)房租",1,63000\n';
    const err = (() => {
      try {
        parseTaipeiCpiRent(text, 'cpi.csv');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.file).toBe('cpi.csv');
    expect(err.row).toBe(1);
    expect(err.expected).toContain('原始值[統計數值]');
    expect(err.message).toContain('原始值[統計數值]');
  });

  it('throws ParseError for a bad period, a non-positive value and a duplicate month', () => {
    expect(() => parseTaipeiCpiRent(`${HEADER}\n"2014-01","(一)房租",94,1,63000\n`, 'c.csv')).toThrow(/row 2/);
    expect(() => parseTaipeiCpiRent(`${HEADER}\n"103年 1月","(一)房租",abc,1,63000\n`, 'c.csv')).toThrow(/not a positive number/);
    const dup = `${HEADER}\n"103年 1月","(一)房租",94,1,63000\n"103年 1月","(一)房租",95,1,63000\n`;
    expect(() => parseTaipeiCpiRent(dup, 'c.csv')).toThrow(/row 3.*duplicate month/);
  });

  it('throws ParseError when no rent row of code 63000 exists', () => {
    expect(() => parseTaipeiCpiRent(`${HEADER}\n"103年 1月","總指數",94,1,63000\n`, 'c.csv')).toThrow(ParseError);
    expect(() => parseTaipeiCpiRent(`${HEADER}\n"103年 1月","(一)房租",94,1,65000\n`, 'c.csv')).toThrow(/no rent rows/);
  });
});

const obs = (item: string, period: string, type: string, value: string) =>
  `<Obs><Item>${item}</Item><TIME_PERIOD>${period}</TIME_PERIOD><FREQ>M</FREQ><TYPE>${type}</TYPE>\n<Item_VALUE>${value}</Item_VALUE></Obs>`;
const RENT = '1.房租(指數基期：民國110年=100)';
const wrap = (body: string) => `<?xml version="1.0" encoding="utf-8" ?>\n<DataSet Sender_NAME="x">\n${body}\n</DataSet>`;

describe('parseDgbasCpiRent', () => {
  it('returns only the 原始值 observations of the rent item', () => {
    const xml = wrap(
      [
        obs('總指數(指數基期：民國110年=100)', '2015M01', '原始值', '90.1'),
        obs(RENT, '2015M02', '原始值', '91.2'),
        obs(RENT, '2015M01', '原始值', '91'),
        obs(RENT, '2015M01', '年增率(%)', '1.1'),
        obs('11.房租外項目(指數基期：民國110年=100)', '2015M01', '原始值', '5'),
      ].join('\n'),
    );
    expect(parseDgbasCpiRent(xml, 'cpi.xml')).toEqual([
      { yearMonth: '2015-01', value: 91 },
      { yearMonth: '2015-02', value: 91.2 },
    ]);
  });

  it('omits an observation with an empty value so the builder can report the month', () => {
    const xml = wrap([obs(RENT, '2015M01', '原始值', '91'), obs(RENT, '2015M02', '原始值', '')].join('\n'));
    expect(parseDgbasCpiRent(xml, 'cpi.xml')).toEqual([{ yearMonth: '2015-01', value: 91 }]);
  });

  it('throws ParseError naming the missing element and the Obs position', () => {
    const xml = wrap(`${obs(RENT, '2015M01', '原始值', '91')}\n<Obs><Item>${RENT}</Item><FREQ>M</FREQ><TYPE>原始值</TYPE></Obs>`);
    const err = (() => {
      try {
        parseDgbasCpiRent(xml, 'cpi.xml');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.row).toBe(2);
    expect(err.message).toContain('<TIME_PERIOD>');
    expect(err.found).toEqual(['<Item>', '<FREQ>', '<TYPE>']);
  });

  it('throws ParseError for no <Obs>, no rent item, a bad period and a bad value', () => {
    expect(() => parseDgbasCpiRent('<DataSet></DataSet>', 'x.xml')).toThrow(/no <Obs>/);
    expect(() => parseDgbasCpiRent(wrap(obs('總指數', '2015M01', '原始值', '1')), 'x.xml')).toThrow(/no rent observations/);
    expect(() => parseDgbasCpiRent(wrap(obs(RENT, '201501', '原始值', '1')), 'x.xml')).toThrow(/YYYYMmm/);
    expect(() => parseDgbasCpiRent(wrap(obs(RENT, '2015M01', '原始值', 'n/a')), 'x.xml')).toThrow(/not a positive number/);
  });
});
