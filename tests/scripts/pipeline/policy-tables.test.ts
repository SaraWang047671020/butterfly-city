import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataError, ParseError } from '../../../scripts/pipeline/errors.ts';
import {
  isIsoDate,
  lookupEffective,
  parseCommuterPassProducts,
  parseHoldingTaxRates,
  parseSubleasePhases,
} from '../../../scripts/pipeline/parsers/policy-tables.ts';

const HT_HEADER = 'city,effective_date,lowest_rate,highest_rate,legal_text,article_or_version,source,url';
const CP_HEADER = 'city,product,start_date,price_twd,source,url';
const SP_HEADER = 'city,channel,phase,start_date,total_units,as_of,source,url';

function dataError(fn: () => unknown): DataError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected a DataError');
}

describe('parseHoldingTaxRates', () => {
  const ok = [
    HT_HEADER,
    'statutory,2014-06-06,1.5,3.6,房屋稅條例,Art. 5,policy/act,https://x',
    'Taipei,2014-07-01,2.4,3.6,自治條例,Art. 4,policy/tp,https://x',
    'Taipei,2024-07-01,3.2,4.8,自治條例,Art. 4,policy/tp,https://x',
    'New Taipei,2017-07-01,2.4,2.4,自治條例,Art. 2,policy/ntpc,https://x',
  ].join('\n');

  it('parses typed rows with CSV row numbers', () => {
    const rows = parseHoldingTaxRates(ok, 't.csv');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ row: 4, city: 'Taipei', effectiveDate: '2024-07-01', lowestRate: 3.2, highestRate: 4.8, source: 'policy/tp' });
  });

  it('throws ParseError for a missing column', () => {
    const e = (() => {
      try {
        parseHoldingTaxRates('city,effective_date,lowest_rate\nTaipei,2014-07-01,2', 't.csv');
      } catch (x) {
        return x as ParseError;
      }
      throw new Error('no error');
    })();
    expect(e).toBeInstanceOf(ParseError);
    expect(e.row).toBe(1);
    expect(e.expected).toContain('highest_rate');
  });

  it('rejects a date that is not later than the previous row of the same city (example)', () => {
    const text = `${HT_HEADER}\nTaipei,2017-07-01,2.4,3.6,t,a,s,u\nTaipei,2017-07-01,2.4,3.6,t,a,s,u`;
    const e = dataError(() => parseHoldingTaxRates(text, 'data/config/holding-tax-rates.csv'));
    expect(e.message).toContain('not later than the previous row');
    expect(e.subject).toBe('data/config/holding-tax-rates.csv row 3');
  });

  it('allows the same date in different cities', () => {
    const text = `${HT_HEADER}\nTaipei,2017-07-01,2.4,3.6,t,a,s,u\nNew Taipei,2017-07-01,2.4,2.4,t,a,s,u`;
    expect(parseHoldingTaxRates(text, 't.csv')).toHaveLength(2);
  });

  it.each([
    ['Taipei,2017-02-30,2.4,3.6,t,a,s,u', /valid ISO date/],
    ['Taipei,2017-07-01,0,3.6,t,a,s,u', /positive/],
    ['Taipei,2017-07-01,2.4,-1,t,a,s,u', /positive/],
    ['Taipei,2017-07-01,2.4,3.6,t,a,,u', /source is empty/],
    ['Taipei,2017-07-01,4,3.6,t,a,s,u', /above highest_rate/],
    ['Tainan,2017-07-01,2,3,t,a,s,u', /city/],
  ])('rejects %s', (line, reason) => {
    const e = dataError(() => parseHoldingTaxRates(`${HT_HEADER}\n${line}`, 't.csv'));
    expect(e.message).toMatch(reason);
    expect(e.subject).toBe('t.csv row 2');
  });
});

describe('parseCommuterPassProducts', () => {
  const ok = [
    CP_HEADER,
    'Taipei,1280 pass,2018-04-16,1280,policy/trtc,https://x',
    'Taipei,TPASS,2023-07-01,1200,policy/trtc,https://x',
    'New Taipei,1280 pass,2018-04-16,1280,policy/trtc,https://x',
  ].join('\n');

  it('parses rows', () => {
    const rows = parseCommuterPassProducts(ok, 'c.csv');
    expect(rows[1]).toMatchObject({ row: 3, city: 'Taipei', effectiveDate: '2023-07-01', priceTwd: 1200 });
  });

  it('throws ParseError for a missing column', () => {
    expect(() => parseCommuterPassProducts('city,product,start_date\nTaipei,a,2018-04-16', 'c.csv')).toThrow(ParseError);
  });

  it('rejects an earlier date, a zero price and a missing source', () => {
    const early = `${CP_HEADER}\nTaipei,a,2023-07-01,1200,s,u\nTaipei,b,2018-04-16,1280,s,u`;
    expect(dataError(() => parseCommuterPassProducts(early, 'c.csv')).message).toMatch(/not later/);
    expect(dataError(() => parseCommuterPassProducts(`${CP_HEADER}\nTaipei,a,2018-04-16,0,s,u`, 'c.csv')).message).toMatch(/positive/);
    expect(dataError(() => parseCommuterPassProducts(`${CP_HEADER}\nTaipei,a,2018-04-16,5,,u`, 'c.csv')).message).toMatch(/source/);
  });
});

describe('parseSubleasePhases', () => {
  const ok = [
    SP_HEADER,
    'Taipei,city,1,2017-01-01,1166,2026-10-31,policy/b5010,u',
    'Taipei,city,2,2020-01-16,614,2026-10-31,policy/b5010,u',
    'Taipei,central,2,2020-01-16,578,2026-10-31,policy/b5010,u',
  ].join('\n');

  it('parses rows; the same date in another channel is allowed', () => {
    const rows = parseSubleasePhases(ok, 's.csv');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ row: 4, channel: 'central', phase: 2, totalUnits: 578, asOf: '2026-10-31' });
  });

  it('throws ParseError for a missing column', () => {
    expect(() => parseSubleasePhases('city,channel,phase\nTaipei,city,1', 's.csv')).toThrow(ParseError);
  });

  it('rejects a start date not later than the previous phase of the same city and channel', () => {
    const text = `${ok}\nTaipei,city,3,2020-01-16,5,2026-10-31,s,u`;
    const e = dataError(() => parseSubleasePhases(text, 's.csv'));
    expect(e.subject).toBe('s.csv row 5');
    expect(e.message).toMatch(/not later/);
  });

  it('rejects a bad channel and a missing source', () => {
    expect(dataError(() => parseSubleasePhases(`${SP_HEADER}\nTaipei,x,1,2017-01-01,1,2026-10-31,s,u`, 's.csv')).message).toMatch(/channel/);
    expect(dataError(() => parseSubleasePhases(`${SP_HEADER}\nTaipei,city,1,2017-01-01,1,2026-10-31,,u`, 's.csv')).message).toMatch(/source/);
  });
});

describe('lookupEffective', () => {
  const rows = [
    { city: 'Taipei', effectiveDate: '2024-07-01', v: 'c' },
    { city: 'Taipei', effectiveDate: '2014-07-01', v: 'a' },
    { city: 'New Taipei', effectiveDate: '2017-07-01', v: 'x' },
    { city: 'Taipei', effectiveDate: '2017-07-01', v: 'b' },
  ];
  it('returns the latest row not after the date, for the city', () => {
    expect(lookupEffective(rows, 'Taipei', '2017-07-01')?.v).toBe('b');
    expect(lookupEffective(rows, 'Taipei', '2030-01-01')?.v).toBe('c');
    expect(lookupEffective(rows, 'Taipei', '2014-06-30')).toBeUndefined();
    expect(lookupEffective(rows, 'New Taipei', '2017-06-30')).toBeUndefined();
  });
  it('validates ISO dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-2-1')).toBe(false);
  });
});

describe('committed data/config tables', () => {
  const read = (name: string): string => readFileSync(new URL(`../../../data/config/${name}`, import.meta.url), 'utf8');
  it('pass the row checks', () => {
    expect(parseHoldingTaxRates(read('holding-tax-rates.csv'), 'data/config/holding-tax-rates.csv').length).toBeGreaterThan(0);
    expect(parseCommuterPassProducts(read('commuter-pass-products.csv'), 'data/config/commuter-pass-products.csv').length).toBeGreaterThan(0);
    expect(parseSubleasePhases(read('sublease-phases.csv'), 'data/config/sublease-phases.csv').length).toBeGreaterThan(0);
  });
});
