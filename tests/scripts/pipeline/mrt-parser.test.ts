/**
 * Tests for parsers/mrt.ts on inline fixtures (never reads data/raw/).
 *
 * The daily files are Big5. Node has no Big5 encoder, so the Big5 test builds the bytes of a few characters from a
 * small hand-written table (checked against TextDecoder('big5')) and decodes them through `MemoryRawReader.readText`,
 * the same path the pipeline uses. The parser tests themselves run on already decoded text.
 */
import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseMrtAnnual, parseMrtDailyEntries } from '../../../scripts/pipeline/parsers/mrt.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';

const ANNUAL = [
  '"統計期","捷運站別","進站人次","出站人次","進站人次增減率[%]","出站人次增減率[%]"',
  '"103年","松山機場",1957390,1857025,6.61,7.56',
  '"104年","板橋Y",0,0,,',
  '"104年","南京復興BR","7,037,986",7691797,-0.75,-1.82',
  '"114年","一日票",0,0,,',
].join('\n');

const DAILY = [
  '日期,松山機場,頂埔',
  '2015/1/1,"4,417","10,131 "',
  '2015/1/2,"4,360","0"',
].join('\n');

function thrown(fn: () => unknown): ParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    return e as ParseError;
  }
  throw new Error('expected ParseError');
}

describe('parseMrtAnnual', () => {
  it('converts ROC years, reads entries with separators and keeps non-station rows', () => {
    expect(parseMrtAnnual(ANNUAL, 'a.csv')).toEqual([
      { year: 2014, name: '松山機場', entries: 1957390 },
      { year: 2015, name: '板橋Y', entries: 0 },
      { year: 2015, name: '南京復興BR', entries: 7037986 },
      { year: 2025, name: '一日票', entries: 0 },
    ]);
  });

  it('accepts a BOM', () => {
    expect(parseMrtAnnual(`\uFEFF${ANNUAL}`, 'a.csv')).toHaveLength(4);
  });

  it('throws ParseError with file, row, expected and found for a missing column', () => {
    const err = thrown(() => parseMrtAnnual('"統計期","捷運站別","出站人次"\n"103年","松山機場",1', 'a.csv'));
    expect(err.file).toBe('a.csv');
    expect(err.row).toBe(1);
    expect(err.expected).toEqual(['統計期', '捷運站別', '進站人次']);
    expect(err.found).toEqual(['統計期', '捷運站別', '出站人次']);
  });

  it('throws on a non-numeric entry, a bad period and a duplicate row', () => {
    const header = '統計期,捷運站別,進站人次\n';
    expect(thrown(() => parseMrtAnnual(`${header}103年,松山機場,abc`, 'a.csv')).row).toBe(2);
    expect(thrown(() => parseMrtAnnual(`${header}2014,松山機場,1`, 'a.csv')).row).toBe(2);
    expect(thrown(() => parseMrtAnnual(`${header}103年,松山機場,1\n103年,松山機場,2`, 'a.csv')).row).toBe(3);
  });
});

describe('parseMrtDailyEntries', () => {
  it('returns ISO dates and one entry per station column of the file', () => {
    const rows = parseMrtDailyEntries(DAILY, 'd.csv');
    expect(rows.map((r) => r.date)).toEqual(['2015-01-01', '2015-01-02']);
    expect([...(rows[0]?.entries ?? [])]).toEqual([
      ['松山機場', 4417],
      ['頂埔', 10131],
    ]);
    expect(rows[1]?.entries.get('松山機場')).toBe(4360);
  });

  it('uses the station columns of each file, so files may differ', () => {
    const rows = parseMrtDailyEntries('日期,松山機場\n2016/12/31,"1"', 'd.csv');
    expect([...(rows[0]?.entries.keys() ?? [])]).toEqual(['松山機場']);
  });

  it('throws ParseError when the date column is missing', () => {
    const err = thrown(() => parseMrtDailyEntries('松山機場,頂埔\n1,2', 'd.csv'));
    expect(err.file).toBe('d.csv');
    expect(err.row).toBe(1);
    expect(err.found).toEqual(['松山機場', '頂埔']);
    expect(err.expected[0]).toBe('日期');
  });

  it('throws on a bad date, a short row, a non-numeric cell and a duplicate station column', () => {
    expect(thrown(() => parseMrtDailyEntries('日期,松山機場\n2015/13/1,1', 'd.csv')).row).toBe(2);
    expect(thrown(() => parseMrtDailyEntries('日期,松山機場\n2015/2/30,1', 'd.csv')).row).toBe(2);
    expect(thrown(() => parseMrtDailyEntries('日期,松山機場,頂埔\n2015/1/1,1', 'd.csv')).row).toBe(2);
    expect(thrown(() => parseMrtDailyEntries('日期,松山機場\n2015/1/1,x', 'd.csv')).row).toBe(2);
    expect(thrown(() => parseMrtDailyEntries('日期,松山機場,松山機場\n2015/1/1,1,2', 'd.csv')).row).toBe(1);
  });

  it('parses a Big5-encoded file decoded through the raw reader', () => {
    // Big5 bytes: 日期 = A4E9 B4C1, 松山 = AA51 A473, 機場 = BEF7 B3F5.
    const big5 = (hex: string[]): number[] => hex.flatMap((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2), 16)]);
    const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    const bytes = Uint8Array.from([
      ...big5(['A4E9', 'B4C1']), ...ascii(','), ...big5(['AA51', 'A473', 'BEF7', 'B3F5']), ...ascii('\r\n2015/1/1,"4,417"\r\n'),
    ]);
    const reader = new MemoryRawReader({ 'mrt/daily/taipei-entries-2015-01.csv': bytes });
    const text = reader.readText('mrt/daily/taipei-entries-2015-01.csv', 'big5');
    expect(text.startsWith('日期,松山機場')).toBe(true);
    const rows = parseMrtDailyEntries(text, reader.display('mrt/daily/taipei-entries-2015-01.csv'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entries.get('松山機場')).toBe(4417);
  });
});
