import { describe, expect, it } from 'vitest';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { CPI_SERIES_BY_CITY, checkCpiMapping, cpiSeriesFor } from '../../../scripts/pipeline/tables/cpi-series.ts';
import { RENT_REFERENCE, checkReferenceTable, ratioMethodFor, type RentReferenceEntry } from '../../../scripts/pipeline/tables/rent-reference.ts';

describe('cpi-series', () => {
  it('assigns Taipei DBAS 131822 to Taipei and DGBAS 6019 to New Taipei', () => {
    expect(cpiSeriesFor('Taipei')).toBe('macro/taipei-dbas-131822');
    expect(cpiSeriesFor('New Taipei')).toBe('macro/dgbas-6019');
  });

  it('accepts the required mapping for all 41 districts', () => {
    expect(() => checkCpiMapping(DISTRICTS)).not.toThrow();
  });

  it('names the District_Code and the wrong series on a mismatch', () => {
    const mapping = { ...CPI_SERIES_BY_CITY, 'New Taipei': 'macro/taipei-dbas-131822' };
    const err = (() => {
      try {
        checkCpiMapping(DISTRICTS, mapping);
      } catch (e) {
        return e;
      }
    })() as DataError;
    expect(err).toBeInstanceOf(DataError);
    expect(err.message).toContain('65000010');
    expect(err.message).toContain('macro/taipei-dbas-131822');
    expect(err.details.join('\n')).toContain('macro/dgbas-6019');
  });

  it('reports a city without any series', () => {
    expect(() => checkCpiMapping([{ code: '63000010', city: 'Taipei' }], {})).toThrow(/63000010 mapped to no series/);
  });
});

// Hand-built fixture: a symmetric adjacency among the districts the table uses.
const EDGES: [string, string][] = [
  ['65000190', '65000180'], // Shiding - Shenkeng
  ['65000190', '65000060'], // Shiding - Xindian
  ['65000190', '65000200'], // Shiding - Pinglin
  ['65000190', '65000240'], // Shiding - Pingxi
  ['65000200', '65000240'], // Pinglin - Pingxi
  ['65000200', '65000290'], // Pinglin - Wulai
  ['65000200', '65000250'], // Pinglin - Shuangxi
  ['65000290', '65000060'], // Wulai - Xindian
  ['65000250', '65000120'], // Shuangxi - Ruifang
  ['65000240', '65000120'], // Pingxi - Ruifang
  ['65000260', '65000120'], // Gongliao - Ruifang
  ['65000220', '65000210'], // Shimen - Sanzhi
];
function adjacencyOf(edges: readonly [string, string][]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [a, b] of edges) {
    m.set(a, [...(m.get(a) ?? []), b]);
    m.set(b, [...(m.get(b) ?? []), a]);
  }
  return m;
}
const THIN = Object.keys(RENT_REFERENCE);
function counts(overrides: Record<string, number> = {}): Map<string, number> {
  const m = new Map<string, number>(DISTRICTS.map((d) => [d.code, THIN.includes(d.code) ? 5 : 500]));
  for (const [k, v] of Object.entries(overrides)) m.set(k, v);
  return m;
}
const adjacency = adjacencyOf(EDGES);

function error(fn: () => unknown): DataError {
  try {
    fn();
  } catch (e) {
    return e as DataError;
  }
  throw new Error('expected a DataError');
}

describe('rent-reference table', () => {
  it('lists the seven design entries, Pinglin by the second rule', () => {
    expect(Object.keys(RENT_REFERENCE)).toHaveLength(7);
    expect(RENT_REFERENCE['65000200']).toMatchObject({ reference: '65000060', relation: 'two-borders-away' });
    expect(RENT_REFERENCE['65000190']).toMatchObject({ reference: '65000180', relation: 'borders' });
  });

  it('passes on the fixture and flags only Pinglin as the second rule', () => {
    const result = checkReferenceTable({ recordCounts: counts(), adjacency, districts: DISTRICTS });
    expect(result.used.map((u) => u.district)).toEqual(THIN);
    expect(result.used.filter((u) => u.secondRule).map((u) => u.district)).toEqual(['65000200']);
    expect(result.notes).toEqual([]);
  });

  it('notes an entry whose district has 30 or more records', () => {
    const result = checkReferenceTable({ recordCounts: counts({ '65000260': 30 }), adjacency, districts: DISTRICTS });
    expect(result.used.map((u) => u.district)).not.toContain('65000260');
    expect(result.notes).toEqual(['reference entry for 65000260 is unused: 30 qualifying records (at least 30)']);
  });

  it('stops when a district below 30 has no entry', () => {
    const err = error(() => checkReferenceTable({ recordCounts: counts({ '65000010': 29 }), adjacency, districts: DISTRICTS }));
    expect(err.message).toBe('rent-reference-missing-entry: 65000010');
  });

  it('stops when the reference is in another city, has too few records or does not border', () => {
    const table = (e: Partial<RentReferenceEntry>): Record<string, RentReferenceEntry> => ({ ...RENT_REFERENCE, '65000190': { ...RENT_REFERENCE['65000190']!, ...e } });
    expect(error(() => checkReferenceTable({ recordCounts: counts(), adjacency, districts: DISTRICTS, table: table({ reference: '63000010' }) })).message).toBe('rent-reference-same-city: 65000190');
    expect(error(() => checkReferenceTable({ recordCounts: counts({ '65000180': 29 }), adjacency: adjacencyOf([...EDGES, ['65000180', '65000060']]), districts: DISTRICTS, table: { ...RENT_REFERENCE, '65000180': { reference: '65000060', relation: 'borders', expectedRatioMethod: 'sale-price' } } })).message).toBe('rent-reference-reference-records: 65000190');
    expect(error(() => checkReferenceTable({ recordCounts: counts(), adjacency, districts: DISTRICTS, table: table({ reference: '65000010' }) })).message).toBe('rent-reference-border: 65000190');
  });

  it('allows the second rule only when no bordering same-city district has 30 records', () => {
    const err = error(() => checkReferenceTable({ recordCounts: counts({ '65000290': 40 }), adjacency, districts: DISTRICTS }));
    expect(err.message).toBe('rent-reference-second-rule: 65000200');
    expect(err.details.join(' ')).toContain('65000290');
  });

  it('requires a second-rule reference to border a district that borders the district', () => {
    const farther = adjacencyOf(EDGES.filter(([a, b]) => !(a === '65000190' && b === '65000060') && !(a === '65000290' && b === '65000060')));
    const err = error(() => checkReferenceTable({ recordCounts: counts(), adjacency: farther, districts: DISTRICTS }));
    expect(err.message).toContain('rent-reference-two-borders-away: 65000200');
  });

  it('stops on an entry for a code that is not a district', () => {
    const table = { ...RENT_REFERENCE, '99999999': RENT_REFERENCE['65000190']! };
    expect(error(() => checkReferenceTable({ recordCounts: counts(), adjacency, districts: DISTRICTS, table })).message).toBe('rent-reference-unknown-district: 99999999');
  });
});

describe('ratioMethodFor', () => {
  const stats = new Set(DISTRICTS.map((d) => d.code).filter((c) => !THIN.includes(c) || c === '65000260'));

  it('uses the rent statistics only when both districts are in them', () => {
    expect(ratioMethodFor('65000260', '65000120', stats)).toBe('rent-statistics');
    expect(ratioMethodFor('65000190', '65000180', stats)).toBe('sale-price');
    expect(ratioMethodFor('65000120', '65000190', stats)).toBe('sale-price');
  });

  it('agrees with the informational column of the table', () => {
    for (const [d, e] of Object.entries(RENT_REFERENCE)) expect(ratioMethodFor(d, e.reference, stats)).toBe(e.expectedRatioMethod);
  });
});
