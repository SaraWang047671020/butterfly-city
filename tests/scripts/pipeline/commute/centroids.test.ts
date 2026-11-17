import { describe, expect, it } from 'vitest';
import {
  buildCentroids,
  formatLargestOffsets,
  isUnassignedArea,
  parseOdrp019,
  type VillagePopulation,
  type VillageShape,
} from '../../../../scripts/pipeline/commute/centroids.ts';
import { DataError } from '../../../../scripts/pipeline/errors.ts';
import type { Polygon } from '../../../../scripts/geo/shapefile.ts';

const D1 = '63000010';
const D2 = '63000020';
const V1 = `${D1}001`;
const V2 = `${D1}002`;

const square = (x0: number, y0: number, x1: number, y1: number): Polygon[] => [[[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]]];

// D1 is the rectangle lon 0..0.04, lat 0..0.02. V1 is its west half (centre 0.01, 0.01), V2 its east half (centre 0.03, 0.01).
const DISTRICT_SHAPES = [{ code: D1, polygons: square(0, 0, 0.04, 0.02) }];
// Both villages carry the same name: only the code tells them apart.
const POPS: VillagePopulation[] = [
  { code: V1, village: 'Zhongshan', population: 100 },
  { code: V2, village: 'Zhongshan', population: 300 },
];
const SHAPES: VillageShape[] = [
  { code: V1, name: 'Zhongshan', polygons: square(0, 0, 0.02, 0.02) },
  { code: V2, name: 'Zhongshan', polygons: square(0.02, 0, 0.04, 0.02) },
];
const TOTALS = new Map([[D1, 400]]);

function failure(fn: () => unknown): DataError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected the build to stop');
}

describe('buildCentroids', () => {
  it('computes the population-weighted centroid with literal coordinates', () => {
    // lon = (0.01 * 100 + 0.03 * 300) / 400 = 0.025; lat = 0.01. Geometric centroid of the rectangle = (0.02, 0.01).
    const d = buildCentroids(POPS, SHAPES, DISTRICT_SHAPES, TOTALS).districts.get(D1)!;
    expect(d.weighted[0]).toBeCloseTo(0.025, 9);
    expect(d.weighted[1]).toBeCloseTo(0.01, 9);
    expect(d.geometric[0]).toBeCloseTo(0.02, 9);
    expect(d.geometric[1]).toBeCloseTo(0.01, 9);
    expect(d.population).toBe(400);
    expect(d.villageCount).toBe(2);
    // 0.005 degrees of longitude at the equator = 0.556 km.
    expect(d.offsetKm).toBeCloseTo(0.556, 3);
  });

  it('joins by village code, not by name, whatever the record order', () => {
    const swapped = [SHAPES[1]!, SHAPES[0]!];
    const d = buildCentroids([...POPS].reverse(), swapped, DISTRICT_SHAPES, TOTALS).districts.get(D1)!;
    expect(d.weighted[0]).toBeCloseTo(0.025, 9);
  });

  it('stops on a village code that only ODRP019 has, and lists the code', () => {
    const extra = [...POPS, { code: `${D1}003`, village: 'Extra', population: 0 }];
    const e = failure(() => buildCentroids(extra, SHAPES, DISTRICT_SHAPES, TOTALS));
    expect(e.message).toBe('unmatched-village-code: 1 village codes');
    expect(e.details.join('\n')).toContain(`${D1}003 Extra: in ODRP019, not in the village boundary file`);
  });

  it('stops on a village code that only the boundary file has, and lists the code', () => {
    const extra = [...SHAPES, { code: `${D1}004`, name: 'Other', polygons: square(0, 0, 0.01, 0.01) }];
    const e = failure(() => buildCentroids(POPS, extra, DISTRICT_SHAPES, TOTALS));
    expect(e.details.join('\n')).toContain(`${D1}004: in the village boundary file, not in ODRP019`);
  });

  it('skips an unassigned area (empty VILLNAME, R or P in the code) with weight 0', () => {
    const withAreas = [
      ...SHAPES,
      { code: `${D1}R01`, name: '', polygons: square(0.5, 0.5, 0.6, 0.6) },
      { code: `${D1}P01`, name: '', polygons: square(0.7, 0.7, 0.8, 0.8) },
    ];
    const r = buildCentroids(POPS, withAreas, DISTRICT_SHAPES, TOTALS);
    expect(r.unassigned).toEqual([`${D1}P01`, `${D1}R01`]);
    expect(r.districts.get(D1)!.weighted[0]).toBeCloseTo(0.025, 9);
    expect(r.districts.get(D1)!.villageCount).toBe(2);
  });

  it('does not skip a record with a name, or an empty name without R or P', () => {
    expect(isUnassignedArea({ code: `${D1}R01`, name: '' })).toBe(true);
    expect(isUnassignedArea({ code: `${D1}R01`, name: 'Named' })).toBe(false);
    expect(isUnassignedArea({ code: `${D1}005`, name: '' })).toBe(false);
    const named = [...SHAPES, { code: `${D1}R02`, name: 'Named', polygons: square(0, 0, 0.01, 0.01) }];
    expect(failure(() => buildCentroids(POPS, named, DISTRICT_SHAPES, TOTALS)).details.join('\n')).toContain(`${D1}R02`);
  });

  it('fails the population sum check with the District_Code', () => {
    const e = failure(() => buildCentroids(POPS, SHAPES, DISTRICT_SHAPES, new Map([[D1, 399]])));
    expect(e.message).toBe(`district-population-mismatch: ${D1}`);
    expect(e.details).toEqual(['village sum 400', 'district total 399']);
  });

  it('stops on a district without a village', () => {
    const two = [...DISTRICT_SHAPES, { code: D2, polygons: square(1, 1, 1.1, 1.1) }];
    const e = failure(() => buildCentroids(POPS, SHAPES, two, new Map([...TOTALS, [D2, 0]])));
    expect(e.message).toBe(`district-without-village: ${D2}`);
  });

  it('ignores villages of districts outside the list and returns the largest offsets first', () => {
    const outside = [...POPS, { code: '99999999001', village: 'Elsewhere', population: 5 }];
    const r = buildCentroids(outside, SHAPES, DISTRICT_SHAPES, TOTALS);
    expect([...r.districts.keys()]).toEqual([D1]);
    expect(formatLargestOffsets(r)).toEqual([`${D1} 0.56 km`]);
  });
});

describe('parseOdrp019', () => {
  const row = (code: string, n: number) => ({
    district_code: code,
    village: 'V',
    household_ordinary_m: String(n),
    household_business_m: '1',
    household_single_m: '2',
    household_ordinary_f: String(n),
    household_business_f: '3',
    household_single_f: '4',
  });
  const page = (rows: unknown[]) => ({ text: JSON.stringify({ responseData: rows }), shown: 'page1' });

  it('sums the six population fields per village code', () => {
    expect(parseOdrp019([page([row(V1, 10)])])).toEqual([{ code: V1, village: 'V', population: 30 }]);
  });

  it('rejects a duplicate village code and a code that is not 11 digits', () => {
    expect(() => parseOdrp019([page([row(V1, 1), row(V1, 2)])])).toThrow(/odrp019-duplicate-village/);
    expect(() => parseOdrp019([page([row('123', 1)])])).toThrow(/odrp019-village-code/);
  });
});
