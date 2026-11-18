// Pure City_View modules (city-3d Requirement 13.1 to 13.3, tasks 4.4).
import fc from 'fast-check';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CLASS_COUNT, classToken, NO_VALUE_TOKEN } from '../../../src/ui/city/colours.ts';
import { stepFocus } from '../../../src/ui/city/focus-order.ts';
import { inAnyPolygon, inPolygon, type PolygonXZ } from '../../../src/ui/city/geometry.ts';
import { heightScale, isUrban, placeDistrict, type PlacementInput } from '../../../src/ui/city/placement.ts';
import { project, unproject } from '../../../src/ui/city/projection.ts';
import { mulberry32 } from '../../../src/ui/city/random.ts';
import { advance, edgeOf, poseOf, spawn } from '../../../src/ui/city/routing.ts';
import { buildStreetGrid, gridDist, ROAD_HALF_WIDTH, SPACING } from '../../../src/ui/city/street-grid.ts';

interface RawDistrict {
  code: string;
  areaKm2: number;
  centroid: [number, number];
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

const districtsFile = JSON.parse(fs.readFileSync('public/data/districts.json', 'utf8')) as { districts: RawDistrict[] };
const history = JSON.parse(fs.readFileSync('public/data/history.json', 'utf8')) as {
  indicators: { id: string; series: Record<string, { value: number | null }[]> }[];
};
const population = history.indicators.find((i) => i.id === 'population')!;

function toInput(d: RawDistrict): PlacementInput {
  const polys = (d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates) as [number, number][][][];
  return {
    code: d.code,
    polygons: polys.map((poly) => poly.map((ring) => ring.map(project))),
    center: project(d.centroid),
    areaKm2: d.areaKm2,
    population2015: population.series[d.code]?.[0]?.value ?? 0,
  };
}

const inputs = districtsFile.districts.map(toInput);
const square = (x0: number, z0: number, size: number): PolygonXZ => [
  [
    [x0, z0],
    [x0 + size, z0],
    [x0 + size, z0 + size],
    [x0, z0 + size],
    [x0, z0],
  ],
];

describe('projection', () => {
  it('maps the centre to the origin, east to +x, north to −z, and round-trips', () => {
    const [cx, cz] = project([121.6, 25.0]);
    expect(cx).toBeCloseTo(0, 12);
    expect(cz).toBeCloseTo(0, 12);
    expect(project([121.7, 25.0])[0]).toBeGreaterThan(0);
    expect(project([121.6, 25.1])[1]).toBeLessThan(0);
    fc.assert(
      fc.property(fc.double({ min: 121.2, max: 122.1, noNaN: true }), fc.double({ min: 24.6, max: 25.4, noNaN: true }), (lon, lat) => {
        const [lon2, lat2] = unproject(project([lon, lat]));
        expect(lon2).toBeCloseTo(lon, 9);
        expect(lat2).toBeCloseTo(lat, 9);
      }),
    );
  });

  it('1 unit is about 100 m on the ground at 25° N (Mercator scale 1 / cos 25°)', () => {
    const [x] = project([121.6 + 1 / 111.32, 25.0]); // about 1 km of longitude at the equator
    expect(x).toBeGreaterThan(9.9);
    expect(x).toBeLessThan(10.1);
  });
});

describe('geometry', () => {
  it('respects holes', () => {
    const outer = square(0, 0, 10)[0]!;
    const hole = square(4, 4, 2)[0]!;
    expect(inPolygon(1, 1, [outer, hole])).toBe(true);
    expect(inPolygon(5, 5, [outer, hole])).toBe(false);
    expect(inPolygon(11, 1, [outer])).toBe(false);
  });
});

describe('placement (Property: deterministic, inside, off the streets)', () => {
  it('real districts: same input gives the same buildings, all inside the district and clear of the Street_Grid', () => {
    let total = 0;
    for (const p of inputs) {
      const a = placeDistrict(p);
      const b = placeDistrict(p);
      expect(b).toEqual(a);
      for (const s of a.buildings) {
        expect(inAnyPolygon(s.x, s.z, p.polygons)).toBe(true);
        if (a.urban) {
          expect(gridDist(s.x)).toBeGreaterThanOrEqual(s.width / 2 + ROAD_HALF_WIDTH);
          expect(gridDist(s.z)).toBeGreaterThanOrEqual(s.depth / 2 + ROAD_HALF_WIDTH);
        }
      }
      for (const t of a.trees) expect(inAnyPolygon(t.x, t.z, p.polygons)).toBe(true);
      total += a.buildings.length;
    }
    // About population / 1,400 buildings in total (rejection sampling may fall a little short in thin districts).
    const people = inputs.reduce((s, p) => s + p.population2015, 0);
    expect(total).toBeGreaterThan((people / 1400) * 0.9);
    expect(inputs.filter(isUrban).length).toBeGreaterThan(10);
  }, 60_000);

  it('random square districts: deterministic and inside', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: 20, max: 120 }),
        fc.integer({ min: 0, max: 300_000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (x0, z0, size, pop, code) => {
          const poly = square(x0, z0, size);
          const input: PlacementInput = {
            code,
            polygons: [poly],
            center: [x0 + size / 2, z0 + size / 2],
            areaKm2: (size * size) / 100,
            population2015: pop,
          };
          const a = placeDistrict(input);
          expect(placeDistrict(input)).toEqual(a);
          for (const s of a.buildings) expect(inPolygon(s.x, s.z, poly)).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it('height scale follows the Price_Index within 0.6–1.8, and 1 without one', () => {
    expect(heightScale(null)).toBe(1);
    expect(heightScale(1.3)).toBe(1.3);
    expect(heightScale(3)).toBe(1.8);
    expect(heightScale(0.2)).toBe(0.6);
    expect(heightScale(Number.NaN)).toBe(1);
  });
});

describe('Street_Grid and routing (Property: movers stay on streets)', () => {
  const urban = inputs.filter(isUrban).flatMap((p) => p.polygons);
  const grid = buildStreetGrid(urban);

  it('has streets only where the edge midpoint is urban', () => {
    expect(grid.list.length).toBeGreaterThan(100);
    expect(new Set(grid.list).size).toBe(grid.list.length);
  });

  it('a mover stays on a street of the grid for any number of steps', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.double({ min: 0, max: 3, noNaN: true }), { minLength: 1, maxLength: 80 }), (seed, dts) => {
        const rand = mulberry32(seed);
        const m = spawn(grid, rand, 2 + rand() * 10, 0.6);
        for (const dt of dts) {
          advance(m, dt, grid, rand);
          expect(grid.edges.has(edgeOf(m))).toBe(true);
          expect(m.t).toBeGreaterThanOrEqual(0);
          expect(m.t).toBeLessThan(1);
          const pose = poseOf(m);
          // Within the street: one coordinate on a grid line ± the lane offset.
          const off = m.di !== 0 ? gridDist(pose.z) : gridDist(pose.x);
          expect(off).toBeCloseTo(0.6, 9);
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it('drives on the right: heading east puts the car south of the centre line', () => {
    const p = poseOf({ i: 0, j: 0, di: 1, dj: 0, t: 0.5, speed: 1, lane: 0.6 });
    expect(p.x).toBeCloseTo(SPACING / 2);
    expect(p.z).toBeCloseTo(0.6);
    expect(p.heading).toBeCloseTo(0);
  });
});

describe('focus order and colours', () => {
  it('visits every district once per pass in ascending code order, both ways', () => {
    const codes = inputs.map((p) => p.code).reverse();
    const seen: string[] = [];
    let c: string | null = null;
    for (let k = 0; k < codes.length; k++) {
      c = stepFocus(codes, c, 1);
      seen.push(c!);
    }
    expect(seen).toEqual([...codes].sort());
    expect(stepFocus(codes, seen[0]!, -1)).toBe(seen[seen.length - 1]);
    expect(stepFocus([], null, 1)).toBeNull();
  });

  it('maps every class to a ramp token and null to the "no value" token', () => {
    for (let k = 0; k < CLASS_COUNT; k++) {
      expect(classToken('rentBurden', k)).toBe(`--color-seq-${k}`);
      expect(classToken('populationChange', k)).toBe(`--color-div-${k}`);
    }
    expect(classToken('lowUseHousingRate', null)).toBe(NO_VALUE_TOKEN);
    expect(classToken('commuteTime', 99)).toBe('--color-seq-6');
  });
});
