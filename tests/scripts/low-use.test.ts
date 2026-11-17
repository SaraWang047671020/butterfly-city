import { describe, expect, it } from 'vitest';
import { parseLowUseCsv, toLowUsePeriod } from '../../scripts/sources/low-use.ts';

describe('low-use source', () => {
  it('parses a district CSV with a BOM and keeps the period label', () => {
    const csv = '\uFEFF"縣市","鄉鎮市區","114H2宅數","114H2比率(%)"\r\n"臺北市","全區",58648,6.39\r\n"臺北市","松山區",3698,5.57\r\n';
    expect(parseLowUseCsv(csv)).toEqual([
      { zh: '臺北市全區', period: '114H2', count: 58648, ratePercent: 6.39 },
      { zh: '臺北市松山區', period: '114H2', count: 3698, ratePercent: 5.57 },
    ]);
  });

  it('stops on a missing count column', () => {
    expect(() => parseLowUseCsv('"縣市","鄉鎮市區","114H2比率(%)"\n"臺北市","松山區",5.57\n')).toThrow(/unexpected header/);
  });

  it('maps ROC periods to half-years; an annual year maps to H2', () => {
    expect(toLowUsePeriod('109H1')).toBe('2020H1');
    expect(toLowUsePeriod('114H2')).toBe('2025H2');
    expect(toLowUsePeriod('108')).toBe('2019H2');
    expect(toLowUsePeriod('x')).toBeUndefined();
  });
});
