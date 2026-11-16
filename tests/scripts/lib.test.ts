import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, parseNumber } from '../../scripts/lib/csv.ts';
import { DISTRICTS, districtByZh, missingDistricts } from '../../scripts/lib/districts.ts';
import { isPdf, notHtml } from '../../scripts/lib/http.ts';
import { quartersBetween, rocDateToQuarter, rocMonthsBetween } from '../../scripts/lib/time.ts';
import { readOdsRows, readZip } from '../../scripts/lib/zip.ts';
import { makeOds, makeZip } from './helpers.ts';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('a,"b,c","say ""hi""","line\nbreak"\n1,2,3,4')).toEqual([
      ['a', 'b,c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('strips a UTF-8 BOM and accepts CRLF line endings', () => {
    expect(parseCsv('\uFEFFx,y\r\n1,2\r\n')).toEqual([['x', 'y'], ['1', '2']]);
  });

  it('builds objects from the header and can skip a second header row', () => {
    const text = '鄉鎮市區,中位數\nThe villages,median\n板橋區, 625 \n\n';
    expect(parseCsvObjects(text, 1)).toEqual([{ 鄉鎮市區: '板橋區', 中位數: '625' }]);
  });

  it('parses numbers with separators and rejects text', () => {
    expect(parseNumber('1,172')).toBe(1172);
    expect(parseNumber('1 162')).toBe(1162);
    expect(parseNumber('-3.5')).toBe(-3.5);
    expect(parseNumber('-')).toBeNaN();
    expect(parseNumber('x')).toBeNaN();
  });
});

describe('time', () => {
  it('converts ROC dates to quarters', () => {
    expect(rocDateToQuarter('1121108')).toBe('2023Q4');
    expect(rocDateToQuarter('1040101')).toBe('2015Q1');
    expect(rocDateToQuarter('991231')).toBe('2010Q4');
    expect(rocDateToQuarter('1041301')).toBeUndefined();
    expect(rocDateToQuarter('abc')).toBeUndefined();
  });

  it('lists the 44 quarters and 132 months of 2015–2025', () => {
    const q = quartersBetween();
    expect(q).toHaveLength(44);
    expect(q[0]).toBe('2015Q1');
    expect(q[43]).toBe('2025Q4');
    const m = rocMonthsBetween();
    expect(m).toHaveLength(132);
    expect([m[0], m[131]]).toEqual(['10401', '11412']);
  });
});

describe('districts', () => {
  it('has 41 unique official codes: 12 Taipei and 29 New Taipei', () => {
    expect(new Set(DISTRICTS.map((d) => d.code)).size).toBe(41);
    expect(DISTRICTS.filter((d) => d.city === 'Taipei')).toHaveLength(12);
    expect(DISTRICTS.filter((d) => d.city === 'New Taipei')).toHaveLength(29);
  });

  it('matches source names, including the 台北市 variant and whitespace', () => {
    expect(districtByZh('臺北市萬華區')?.name).toBe('Wanhua');
    expect(districtByZh(' 台北市大安區 ')?.code).toBe('63000030');
    expect(districtByZh('基隆市中正區')).toBeUndefined();
  });

  it('reports missing districts by code', () => {
    const all = DISTRICTS.map((d) => d.code);
    expect(missingDistricts(all)).toEqual([]);
    expect(missingDistricts(all.filter((c) => c !== '65000200')).map((d) => d.name)).toEqual(['Pinglin']);
  });
});

describe('zip and ods', () => {
  it('reads stored and deflated entries', () => {
    const zip = makeZip([
      { name: 'a.txt', data: 'stored', store: true },
      { name: '界線.shp', data: Buffer.alloc(5000, 7) },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', '界線.shp']);
    expect(entries[0]!.read().toString()).toBe('stored');
    expect(entries[1]!.read()).toEqual(Buffer.alloc(5000, 7));
  });

  it('rejects files that are not ZIP archives', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just text padding to be long enough'))).toThrow();
  });

  it('reads ODS rows and unescapes cell text', () => {
    expect(readOdsRows(makeOds([['坪林區', '1 162'], ['A & B', '<x>']]))).toEqual([
      ['坪林區', '1 162'],
      ['A & B', '<x>'],
    ]);
  });
});

describe('download validators', () => {
  it('rejects HTML error pages and non-PDF bodies', () => {
    expect(notHtml(Buffer.from('  <!DOCTYPE html><html>'))).toBeDefined();
    expect(notHtml(Buffer.from('a,b\n1,2'))).toBeUndefined();
    expect(isPdf(Buffer.from('%PDF-1.7'))).toBeUndefined();
    expect(isPdf(Buffer.from('<html>'))).toBeDefined();
  });
});
