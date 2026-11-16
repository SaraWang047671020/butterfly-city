import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  parseNewTaipeiAnnualMigration,
  parseTaipeiAnnualMigration,
} from '../../../scripts/pipeline/parsers/migration-annual.ts';

const taipei = DISTRICTS.filter((d) => d.city === 'Taipei');
const q = (s: string) => `"${s}"`;

/** Header like the real file: city total column, then 12 districts, for move-in and move-out. */
function taipeiCsv(opts: { dropOutLast?: boolean } = {}): string {
  const names = (kind: string) => ['總計', ...taipei.map((d) => d.zh.slice(3))].map((n) => `社會增加/${kind}人數/總計[人]/ ${n}`);
  let header = ['統計期', '人口增加數[人]/ 總計', ...names('遷入'), ...names('遷出')];
  if (opts.dropOutLast) header = header.slice(0, -1);
  // Move-in of district i (0-based) in 104年 = 100 + i; move-out = 200 + i. City totals are not used.
  const row = (label: string, inBase: number, outBase: number) => {
    const cells = [label, '5', String(inBase * 12), ...taipei.map((_, i) => String(inBase + i)), String(outBase * 12), ...taipei.map((_, i) => String(outBase + i))];
    return (opts.dropOutLast ? cells.slice(0, -1) : cells).map(q).join(',');
  };
  return [header.map(q).join(','), row('103年', 1000, 2000), row('104年', 100, 200), row('105年', 300, 400)].join('\n');
}

describe('parseTaipeiAnnualMigration', () => {
  it('returns the 2015 (104年) move-in and move-out totals per district', () => {
    const rows = parseTaipeiAnnualMigration(taipeiCsv(), 'taipei.csv');
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ districtCode: '63000010', year: 2015, moveIn: 100, moveOut: 200 });
    expect(rows[11]).toEqual({ districtCode: '63000120', year: 2015, moveIn: 111, moveOut: 211 });
  });

  it('selects another year when asked (2016 = 105年)', () => {
    expect(parseTaipeiAnnualMigration(taipeiCsv(), 'taipei.csv', 2016)[1]).toMatchObject({ moveIn: 301, moveOut: 401 });
  });

  it('throws ParseError with row 1, expected and found columns when a district column is missing', () => {
    const err = (() => {
      try {
        parseTaipeiAnnualMigration(taipeiCsv({ dropOutLast: true }), 'taipei.csv');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.row).toBe(1);
    expect(err.expected.join(' ')).toContain('北投區');
    expect(err.found.join(' ')).toContain('松山區');
  });
});

/** New Taipei file: 54 unlabeled columns; percent3 (index 2) = move-in, percent20 (index 19) = move-out. */
function ntpcCsv(rows: ReadonlyArray<readonly [number | string, string, number, number]>, columns = 54): string {
  const header = Array.from({ length: columns }, (_, i) => `percent${i + 1}`);
  const line = ([year, name, moveIn, moveOut]: readonly [number | string, string, number, number]) => {
    const cells = Array.from({ length: columns }, () => '0');
    cells[0] = String(year);
    cells[1] = name;
    cells[2] = String(moveIn);
    cells[19] = String(moveOut);
    return cells.map((c) => (c.includes(' ') ? q(c) : c)).join(',');
  };
  return [header.join(','), ...rows.map(line)].join('\n');
}

describe('parseNewTaipeiAnnualMigration', () => {
  const csv = ntpcCsv([
    [2014, ' 板橋區', 1, 2],
    [2015, ' 新北市', 164552, 174864], // city row is skipped
    [2015, ' 板橋區', 18620, 22600],
    [2015, ' 三重區', 13812, 15859],
    [2016, ' 板橋區', 7, 8],
  ]);

  it('returns the 2015 percent3 and percent20 totals per district and skips the city row', () => {
    expect(parseNewTaipeiAnnualMigration(csv, 'ntpc.csv')).toEqual([
      { districtCode: '65000010', year: 2015, moveIn: 18620, moveOut: 22600 },
      { districtCode: '65000020', year: 2015, moveIn: 13812, moveOut: 15859 },
    ]);
  });

  it('throws DataError for a 2015 name that matches no district', () => {
    const bad = ntpcCsv([[2015, ' 火星區', 1, 1]]);
    expect(() => parseNewTaipeiAnnualMigration(bad, 'ntpc.csv')).toThrow(DataError);
  });

  it('throws ParseError with row 1, expected and found columns when percent20 is missing', () => {
    const err = (() => {
      try {
        parseNewTaipeiAnnualMigration(ntpcCsv([[2015, ' 板橋區', 1, 1]], 19), 'ntpc.csv');
      } catch (e) {
        return e;
      }
    })() as ParseError;
    expect(err).toBeInstanceOf(ParseError);
    expect(err.row).toBe(1);
    expect(err.expected).toContain('percent20');
    expect(err.found).not.toContain('percent20');
  });
});
