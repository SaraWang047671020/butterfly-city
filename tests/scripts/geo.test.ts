import { describe, expect, it } from 'vitest';
import {
  assemblePolygons,
  pointInRing,
  readDbf,
  readShapefile,
  readShpPoints,
  signedArea,
  type Polygon,
  type Position,
  type Ring,
} from '../../scripts/geo/shapefile.ts';
import { douglasPeucker, simplifyTopology } from '../../scripts/geo/simplify.ts';
import { tm2ToLonLat } from '../../scripts/geo/twd97.ts';
import { makeDbf, makePointShp, makePolygonShp } from './helpers.ts';

// Clockwise exterior (shapefile convention) and a counterclockwise hole.
const outer: Ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
const hole: Ring = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];

describe('ring geometry', () => {
  it('gives clockwise rings a negative signed area', () => {
    expect(signedArea(outer)).toBe(-100);
    expect(signedArea(hole)).toBe(4);
  });

  it('tests points inside rings', () => {
    expect(pointInRing([5, 5], outer)).toBe(true);
    expect(pointInRing([11, 5], outer)).toBe(false);
  });

  it('assigns holes to the exterior that contains them', () => {
    const island: Ring = [[20, 0], [20, 1], [21, 1], [21, 0], [20, 0]];
    const polys = assemblePolygons([outer, island, hole]);
    expect(polys).toHaveLength(2);
    expect(polys[0]).toEqual([outer, hole]);
    expect(polys[1]).toEqual([island]);
  });
});

describe('shapefile reader', () => {
  it('reads polygon records with their DBF attributes', () => {
    const shp = makePolygonShp([[[...outer], [...hole]]]);
    const dbf = makeDbf([{ name: 'TOWNCODE', length: 8 }, { name: 'TOWNNAME', length: 9 }], [['65000200', '坪林區']]);
    const [record] = readShapefile(shp, dbf);
    expect(record!.attributes).toEqual({ TOWNCODE: '65000200', TOWNNAME: '坪林區' });
    expect(record!.polygons).toEqual([[outer, hole]]);
  });

  it('reads point shapefiles', () => {
    expect(readShpPoints(makePointShp([[294883.4, 2784459.2]]))).toEqual([[294883.4, 2784459.2]]);
  });

  it('fails when .shp and .dbf record counts differ', () => {
    const dbf = makeDbf([{ name: 'A', length: 1 }], [['x'], ['y']]);
    expect(readDbf(dbf)).toHaveLength(2);
    expect(() => readShapefile(makePolygonShp([[[...outer]]]), dbf)).toThrow(/records/);
  });
});

describe('douglasPeucker', () => {
  it('drops points within tolerance and keeps points beyond it', () => {
    const line: Position[] = [[121, 25], [121.0005, 25.00001], [121.001, 25], [121.0015, 25.001], [121.002, 25]];
    const out = douglasPeucker(line, 10);
    expect(out).toContainEqual([121, 25]);
    expect(out).toContainEqual([121.002, 25]);
    expect(out).toContainEqual([121.0015, 25.001]); // about 110 m off the chord
    expect(out).not.toContainEqual([121.0005, 25.00001]); // about 1 m off
  });
});

describe('simplifyTopology', () => {
  // Two districts sharing a zig-zag border along x = 121.01, with small (~5 m) wiggles.
  const border: Position[] = Array.from({ length: 21 }, (_, i) => [121.01 + (i % 2 ? 0.00005 : 0), 25 + i * 0.0005]);
  const west: Ring = [[121, 25], [121, 25.01], ...[...border].reverse(), [121, 25]];
  const east: Ring = [[121.02, 25], ...border, [121.02, 25.01], [121.02, 25]];

  it('keeps the shared border identical on both sides', () => {
    const [w, e] = simplifyTopology([[[west]], [[east]]], { toleranceMeters: 20, decimals: 6 });
    const edges = (ring: Ring) => new Set(ring.slice(1).map((p, i) => [ring[i]!, p].map((q) => q.join(',')).sort().join('|')));
    const we = edges(w![0]![0]!);
    const ee = edges(e![0]![0]!);
    const onBorder = (edge: string) => edge.split('|').every((p) => Math.abs(Number(p.split(',')[0]) - 121.01) < 0.0001);
    const westBorder = [...we].filter(onBorder);
    const eastBorder = [...ee].filter(onBorder);
    expect(westBorder.length).toBeGreaterThan(0);
    expect(westBorder.sort()).toEqual(eastBorder.sort());
    // The ~5 m wiggles are gone: the border collapses to one straight edge.
    expect(westBorder).toEqual(['121.01,25|121.01,25.01']);
    expect(w![0]![0]!.length).toBeLessThan(west.length);
  });

  it('does not mutate its input and never drops a feature', () => {
    const tiny: Polygon = [[[121.5, 25.5], [121.5, 25.50001], [121.50001, 25.50001], [121.5, 25.5]]];
    const input = [[tiny]];
    const copy = JSON.parse(JSON.stringify(input));
    const out = simplifyTopology(input, { toleranceMeters: 1000, decimals: 5 });
    expect(input).toEqual(copy);
    expect(out[0]).toHaveLength(1);
  });
});

describe('tm2ToLonLat', () => {
  it('maps the central meridian and the equator exactly', () => {
    const [lon, lat] = tm2ToLonLat(250_000, 0);
    expect(lon).toBeCloseTo(121, 9);
    expect(lat).toBeCloseTo(0, 9);
  });

  it('places Tamsui station within about 100 m of its TDX coordinate', () => {
    // DORTS station point (EPSG:3826) vs TDX R28 Tamsui (121.445805, 25.167745).
    const [lon, lat] = tm2ToLonLat(294883.358, 2784459.182);
    expect(Math.abs(lon - 121.445805)).toBeLessThan(0.001);
    expect(Math.abs(lat - 25.167745)).toBeLessThan(0.001);
  });
});
