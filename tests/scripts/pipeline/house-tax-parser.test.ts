import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import { parseHouseTax6742, parseRegionLabel } from '../../../scripts/pipeline/parsers/house-tax.ts';

/** Annual rows 104..114 for both cities; New Taipei = 1000 + year, Taipei = 2000 + year (ROC). */
function fixture(omit?: string): string {
  const lines = ['"地區別","總計","房屋稅"', '"90年/ 新北市(改制後)",1,5', '"90年 1月/ 臺北市",1,7', '"104年/ 桃園市(改制後)",1,9'];
  for (let y = 104; y <= 114; y++) {
    if (omit !== `${y}N`) lines.push(`"${y}年/ 新北市(改制後)",9,${1000 + y}`);
    if (omit !== `${y}T`) lines.push(`"${y}年/ ${y % 2 === 0 ? '臺北市' : '台北市'}",9,${2000 + y}`);
  }
  lines.push('"115年/ 臺北市",9,1');
  return lines.join('\n');
}

describe('parseRegionLabel', () => {
  it('reads year and city variants', () => {
    expect(parseRegionLabel('90年/ 新北市(改制後)')).toEqual({ rocYear: 90, city: 'New Taipei' });
    expect(parseRegionLabel('104年/ 新北市')).toEqual({ rocYear: 104, city: 'New Taipei' });
    expect(parseRegionLabel('104年/ 台北市')).toEqual({ rocYear: 104, city: 'Taipei' });
    expect(parseRegionLabel('90年 1月/ 臺北市')).toBeUndefined();
    expect(parseRegionLabel('104年/ 臺中市(改制前)')).toBeUndefined();
  });
});

describe('parseHouseTax6742', () => {
  it('returns only annual rows of the two cities for 2015..2025', () => {
    const rows = parseHouseTax6742(fixture(), 'f.csv');
    expect(rows).toHaveLength(22);
    expect(rows[0]).toEqual({ city: 'New Taipei', year: 2015, amountThousand: 1104 });
    expect(rows[1]).toEqual({ city: 'Taipei', year: 2015, amountThousand: 2104 });
    expect(rows.at(-1)).toEqual({ city: 'Taipei', year: 2025, amountThousand: 2114 });
  });

  it('throws ParseError with row 1 when 房屋稅 is missing', () => {
    try {
      parseHouseTax6742('"地區別","總計"\n"104年/ 臺北市",1', 'f.csv');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).row).toBe(1);
      expect((e as ParseError).expected).toEqual(['地區別', '房屋稅']);
    }
  });

  it('rejects a missing year and a non-numeric cell', () => {
    expect(() => parseHouseTax6742(fixture('110N'), 'f.csv')).toThrow(/no annual row for New Taipei 2021/);
    expect(() => parseHouseTax6742(fixture().replace(',1104', ',－'), 'f.csv')).toThrow(/row 5/);
  });
});
