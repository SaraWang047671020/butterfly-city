import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  classifyLvr,
  dedupeById,
  EXCLUSION_REASONS,
  filterLvr,
  formatExclusions,
  parseLvrCsv,
  qualifyRental,
  qualifySale,
  requiredLvrColumns,
  rocDate7ToQuarter,
  type LvrRecord,
} from '../../../scripts/pipeline/parsers/lvr.ts';

const SALE_HEADER = ['鄉鎮市區', '交易標的', '交易年月日', '建物移轉總面積平方公尺', '主要用途', '總價元', '單價元平方公尺', '編號'];
const RENTAL_HEADER = ['鄉鎮市區', '交易標的', '租賃年月日', '建物總面積平方公尺', '主要用途', '總額元', '單價元平方公尺', '編號'];

function csv(header: string[], rows: string[][]): string {
  const english = header.map((_, i) => `en${i}`);
  return [header, english, ...rows].map((r) => r.join(',')).join('\n') + '\n';
}

// columns: district, target, date, area, use, total/rent, unit, id
const sale = (d: string, target: string, date: string, use: string, total: string, unit: string, id: string) =>
  [d, target, date, '50', use, total, unit, id];

describe('rocDate7ToQuarter', () => {
  it('converts valid 7-digit dates', () => {
    expect(rocDate7ToQuarter('1040101')).toBe('2015Q1');
    expect(rocDate7ToQuarter('1141231')).toBe('2025Q4');
    expect(rocDate7ToQuarter('1130229')).toBe('2024Q1'); // leap day
  });
  it('rejects 6-digit, non-numeric and impossible dates', () => {
    expect(rocDate7ToQuarter('991231')).toBeUndefined();
    expect(rocDate7ToQuarter('10401011')).toBeUndefined();
    expect(rocDate7ToQuarter('104010a')).toBeUndefined();
    expect(rocDate7ToQuarter('')).toBeUndefined();
    expect(rocDate7ToQuarter('1041301')).toBeUndefined(); // month 13
    expect(rocDate7ToQuarter('1040001')).toBeUndefined(); // month 0
    expect(rocDate7ToQuarter('1040100')).toBeUndefined(); // day 0
    expect(rocDate7ToQuarter('1040431')).toBeUndefined(); // April 31
    expect(rocDate7ToQuarter('1140229')).toBeUndefined(); // not a leap year
  });
});

describe('parseLvrCsv', () => {
  it('skips both header rows and takes the city from the file name', () => {
    const text = csv(SALE_HEADER, [
      sale('大安區', '房地(土地+建物)', '1040315', '住家用', '10000000', '100000', 'A1'),
      sale('板橋區', '建物', '1040316', '住宅', '5000000', '80000', 'A2'),
    ]);
    const taipei = parseLvrCsv(text, '104S1_a_lvr_land_a.csv', 'sale');
    expect(taipei).toHaveLength(2);
    expect(taipei[0]).toEqual({
      id: 'A1',
      kind: 'sale',
      districtCode: '63000030',
      quarter: '2015Q1',
      target: '房地(土地+建物)',
      use: '住家用',
      unitPrice: 100000,
      totalPrice: 10000000,
      rent: 0,
      area: 50,
    });
    expect(taipei[1]?.districtCode).toBeUndefined(); // 板橋區 is not in Taipei City
    const newTaipei = parseLvrCsv(text, 'data/raw/lvr/104S1_f_lvr_land_a.csv', 'sale');
    expect(newTaipei[0]?.districtCode).toBeUndefined();
    expect(newTaipei[1]?.districtCode).toBe('65000010');
  });

  it('reads rental columns into rent and area', () => {
    const text = csv(RENTAL_HEADER, [['中山區', '建物', '1040701', '30.5', '住家用', '15000', '492', 'R1']]);
    const [r] = parseLvrCsv(text, '104S3_a_lvr_land_c.csv', 'rental');
    expect(r).toMatchObject({ kind: 'rental', rent: 15000, area: 30.5, totalPrice: 0, quarter: '2015Q3', unitPrice: 492 });
  });

  it('records invalid dates and empty numbers without throwing', () => {
    const text = csv(SALE_HEADER, [sale('大安區', '建物', '991231', '住家用', '', '', 'A1')]);
    const [r] = parseLvrCsv(text, '104S1_a_lvr_land_a.csv', 'sale');
    expect(r?.quarter).toBeUndefined();
    expect(r?.unitPrice).toBe(0);
    expect(r?.totalPrice).toBe(0);
  });

  it('throws ParseError with row 1, expected and found names for a missing column', () => {
    const header = SALE_HEADER.filter((h) => h !== '單價元平方公尺');
    const text = csv(header, []);
    let error: unknown;
    try {
      parseLvrCsv(text, '104S1_a_lvr_land_a.csv', 'sale');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    const pe = error as ParseError;
    expect(pe.row).toBe(1);
    expect(pe.expected).toEqual(requiredLvrColumns('sale'));
    expect(pe.found).toEqual(header);
    expect(pe.message).toContain('單價元平方公尺');
  });

  it('throws ParseError when the file name does not match the kind', () => {
    const text = csv(SALE_HEADER, []);
    expect(() => parseLvrCsv(text, '104S1_a_lvr_land_c.csv', 'sale')).toThrow(ParseError);
    expect(() => parseLvrCsv(text, 'sales.csv', 'sale')).toThrow(ParseError);
  });
});

function rec(over: Partial<LvrRecord> = {}): LvrRecord {
  return {
    id: 'X',
    kind: 'sale',
    districtCode: '63000030',
    quarter: '2020Q2',
    target: '建物',
    use: '住家用',
    unitPrice: 1,
    totalPrice: 1,
    rent: 0,
    area: 10,
    ...over,
  };
}

describe('classifyLvr', () => {
  it('returns each exclusion reason once and undefined for a qualifying record', () => {
    expect(classifyLvr(rec())).toBeUndefined();
    expect(classifyLvr(rec({ quarter: undefined }))).toBe('invalid-date');
    expect(classifyLvr(rec({ quarter: '2014Q4' }))).toBe('out-of-range');
    expect(classifyLvr(rec({ quarter: '2026Q1' }))).toBe('out-of-range');
    expect(classifyLvr(rec({ districtCode: undefined }))).toBe('unknown-district');
    expect(classifyLvr(rec({ use: '商業用' }))).toBe('non-residential');
    expect(classifyLvr(rec({ target: '土地' }))).toBe('non-building');
    expect(classifyLvr(rec({ unitPrice: 0 }))).toBe('zero-value');
  });

  it('accepts 住宅 and the parking-inclusive target, and rejects land and parking only', () => {
    expect(classifyLvr(rec({ use: '住商用' }))).toBe('non-residential');
    expect(classifyLvr(rec({ use: '住宅' }))).toBeUndefined();
    expect(classifyLvr(rec({ target: '房地(土地+建物)+車位' }))).toBeUndefined();
    expect(classifyLvr(rec({ target: '車位' }))).toBe('non-building');
  });

  it('applies the rental value rule and no target filter', () => {
    const rental = rec({ kind: 'rental', target: '土地', unitPrice: 0, totalPrice: 0, rent: 9000, area: 20 });
    expect(classifyLvr(rental)).toBeUndefined();
    expect(classifyLvr({ ...rental, rent: 0 })).toBe('zero-value');
    expect(classifyLvr({ ...rental, area: 0 })).toBe('zero-value');
    expect(qualifyRental(rental)).toBe(true);
    expect(qualifySale(rental)).toBe(false);
    expect(qualifySale(rec())).toBe(true);
  });
});

describe('dedupeById', () => {
  it('keeps the first occurrence in sorted file order, whatever the argument order', () => {
    const early = { file: '104S1_a_lvr_land_a.csv', records: [rec({ id: 'D', unitPrice: 1 }), rec({ id: 'E' })] };
    const late = { file: '104S2_a_lvr_land_a.csv', records: [rec({ id: 'D', unitPrice: 2 }), rec({ id: 'F' }), rec({ id: 'F' })] };
    for (const files of [[early, late], [late, early]]) {
      const { records, duplicates } = dedupeById(files);
      expect(records.map((r) => r.id)).toEqual(['D', 'E', 'F']);
      expect(records[0]?.unitPrice).toBe(1);
      expect(duplicates).toBe(2);
    }
  });

  it('keeps records with an empty id', () => {
    const { records, duplicates } = dedupeById([{ file: 'a', records: [rec({ id: '' }), rec({ id: '' })] }]);
    expect(records).toHaveLength(2);
    expect(duplicates).toBe(0);
  });
});

describe('filterLvr', () => {
  it('counts every reason once and lists them in fixed order', () => {
    const records = [
      rec({ id: '1' }),
      rec({ quarter: undefined }),
      rec({ quarter: '2026Q1' }),
      rec({ districtCode: undefined }),
      rec({ use: '工業用' }),
      rec({ target: '土地' }),
      rec({ unitPrice: 0 }),
    ];
    const { qualifying, exclusions } = filterLvr(records, 1);
    expect(qualifying.map((r) => r.id)).toEqual(['1']);
    expect(Object.keys(exclusions)).toEqual([...EXCLUSION_REASONS]);
    expect(Object.values(exclusions)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(formatExclusions(exclusions)[0]).toBe('invalid-date: 1');
    expect(formatExclusions(exclusions)).toHaveLength(7);
  });
});
