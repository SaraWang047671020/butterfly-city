import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from '../../../scripts/lib/csv.ts';
import { sourceById } from '../../../scripts/pipeline/registry/sources.ts';

function load(name: string): { header: string[]; rows: Record<string, string>[] } {
  const text = readFileSync(`data/config/${name}.csv`, 'utf8');
  expect(text.charCodeAt(0)).not.toBe(0xfeff);
  expect(text.includes('\r')).toBe(false);
  const rows = parseCsvObjects(text);
  return { header: Object.keys(rows[0] ?? {}), rows };
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function groupBy(rows: Record<string, string>[], key: (r: Record<string, string>) => string) {
  const m = new Map<string, Record<string, string>[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

function expectStrictlyIncreasing(rows: Record<string, string>[], key: (r: Record<string, string>) => string, col: string) {
  for (const [, group] of groupBy(rows, key)) {
    const dates = group.map((r) => r[col] as string);
    for (const d of dates) expect(isIsoDate(d)).toBe(true);
    for (let i = 1; i < dates.length; i++) expect((dates[i] as string) > (dates[i - 1] as string)).toBe(true);
  }
}

describe('holding-tax-rates.csv', () => {
  const { header, rows } = load('holding-tax-rates');

  it('has the documented columns', () => {
    expect(header).toEqual([
      'city', 'effective_date', 'lowest_rate', 'highest_rate', 'legal_text', 'article_or_version', 'source', 'url',
    ]);
  });

  it('has rows for statutory, Taipei and New Taipei with increasing dates per city', () => {
    expect([...groupBy(rows, (r) => r.city as string).keys()].sort()).toEqual(['New Taipei', 'Taipei', 'statutory']);
    expectStrictlyIncreasing(rows, (r) => r.city as string, 'effective_date');
  });

  it('has positive rates with lowest <= highest', () => {
    for (const r of rows) {
      const lo = Number(r.lowest_rate);
      const hi = Number(r.highest_rate);
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(0);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('cites a registered source and a URL on every row', () => {
    for (const r of rows) {
      expect(() => sourceById(r.source as string)).not.toThrow();
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.legal_text).not.toBe('');
      expect(r.article_or_version).not.toBe('');
    }
  });

  it('records the statutory ranges and the New Taipei start', () => {
    const statutory = rows.filter((r) => r.city === 'statutory');
    expect(statutory.map((r) => [r.effective_date, r.lowest_rate, r.highest_rate])).toEqual([
      ['2014-06-06', '1.5', '3.6'],
      ['2024-07-01', '2.0', '4.8'],
    ]);
    const ntpc = rows.filter((r) => r.city === 'New Taipei');
    expect(ntpc[0]?.effective_date).toBe('2017-07-01');
    expect(ntpc.every((r) => (r.effective_date as string) >= '2017-07-01')).toBe(true);
    expect(statutory[0]?.effective_date as string < (ntpc[0]?.effective_date as string)).toBe(true);
  });
});

describe('commuter-pass-products.csv', () => {
  const { header, rows } = load('commuter-pass-products');

  it('has the documented columns and registered sources', () => {
    expect(header).toEqual(['city', 'product', 'start_date', 'price_twd', 'source', 'url']);
    for (const r of rows) {
      expect(() => sourceById(r.source as string)).not.toThrow();
      expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it('has the 1,280 and 1,200 products for both cities in increasing order', () => {
    expectStrictlyIncreasing(rows, (r) => r.city as string, 'start_date');
    for (const city of ['Taipei', 'New Taipei']) {
      const own = rows.filter((r) => r.city === city);
      expect(own.map((r) => [r.start_date, Number(r.price_twd)])).toEqual([
        ['2018-04-16', 1280],
        ['2023-07-01', 1200],
      ]);
    }
  });
});

describe('sublease-phases.csv', () => {
  const { header, rows } = load('sublease-phases');

  it('has the documented columns and registered sources', () => {
    expect(header).toEqual(['city', 'channel', 'phase', 'start_date', 'total_units', 'as_of', 'source', 'url']);
    for (const r of rows) {
      expect(() => sourceById(r.source as string)).not.toThrow();
      expect(isIsoDate(r.start_date as string)).toBe(true);
      expect(r.as_of).toBe('2026-10-31');
      expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it('has increasing start dates per city and channel', () => {
    expectStrictlyIncreasing(rows, (r) => `${r.city}|${r.channel}`, 'start_date');
  });

  it('matches the MOI totals and phase start dates', () => {
    const got = rows.map((r) => `${r.city}|${r.channel}|${r.phase}|${r.start_date}|${r.total_units}`);
    const want = [
      'Taipei|city|1|2017-01-01|1166',
      'Taipei|city|2|2020-01-16|614',
      'Taipei|central|2|2020-01-16|578',
      'Taipei|city|3|2021-05-31|1171',
      'Taipei|central|3|2021-05-31|3876',
      'Taipei|city|4|2023-07-03|1496',
      'Taipei|central|4|2023-11-01|6944',
      'Taipei|city|5|2025-10-01|272',
      'Taipei|central|5|2025-10-01|4889',
      'New Taipei|city|1|2017-01-01|906',
      'New Taipei|city|2|2020-01-16|1642',
      'New Taipei|central|2|2020-01-16|998',
      'New Taipei|city|3|2021-05-31|2408',
      'New Taipei|central|3|2021-05-31|8743',
      'New Taipei|city|4|2023-07-03|5568',
      'New Taipei|central|4|2023-11-01|20457',
      'New Taipei|city|5|2025-10-01|1427',
      'New Taipei|central|5|2025-10-01|14429',
    ];
    expect(got).toEqual(want);
  });
});
