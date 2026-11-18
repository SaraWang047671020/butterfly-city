// Landmark_Table checks (city-3d Requirement 7.3) and the clearing of illustrative buildings and streets (7.2).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inAnyPolygon, type PolygonXZ } from '../../../src/ui/city/geometry.ts';
import { landmarkClearings } from '../../../src/ui/city/landmarks/index.ts';
import { LANDMARKS } from '../../../src/ui/city/landmarks/table.ts';
import { placeDistrict } from '../../../src/ui/city/placement.ts';
import { project } from '../../../src/ui/city/projection.ts';
import { buildStreetGrid, parseEdge, SPACING } from '../../../src/ui/city/street-grid.ts';

interface RawDistrict {
  code: string;
  name: string;
  areaKm2: number;
  centroid: [number, number];
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}
const districts = (JSON.parse(fs.readFileSync('public/data/districts.json', 'utf8')) as { districts: RawDistrict[] }).districts;
const polygonsOf = (d: RawDistrict): PolygonXZ[] =>
  ((d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates) as [number, number][][][]).map((poly) =>
    poly.map((ring) => ring.map(project)),
  );

describe('Landmark_Table (city-3d 7.1, 7.3)', () => {
  it('each Landmark lies inside the polygon of its District_Code', () => {
    for (const l of LANDMARKS) {
      const d = districts.find((x) => x.code === l.district);
      expect(d, `${l.id}: unknown district ${l.district}`).toBeDefined();
      const [x, z] = project([l.lon, l.lat]);
      expect(inAnyPolygon(x, z, polygonsOf(d!)), `${l.id} outside ${d!.name}`).toBe(true);
    }
  });

  it('has unique ids, an https source with a citation, and a read date', () => {
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(LANDMARKS.length);
    for (const l of LANDMARKS) {
      expect(l.source.url.startsWith('https://')).toBe(true);
      expect(l.source.citation.length).toBeGreaterThan(0);
      expect(l.source.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(l.clearRadius).toBeGreaterThan(0);
    }
  });

  it('every one of the 41 districts has at least one Landmark (user decision 2026-11-18)', () => {
    const covered = new Set(LANDMARKS.map((l) => l.district));
    expect(districts.filter((d) => !covered.has(d.code)).map((d) => d.name)).toEqual([]);
  });

  it('names no politician (neutrality.md)', () => {
    for (const l of LANDMARKS) expect(l.name).not.toMatch(/Chiang|Sun Yat-sen|Memorial/i);
  });
});

describe('clearings (city-3d 7.2)', () => {
  const clearings = landmarkClearings();

  it('no illustrative building or tree stands inside a Landmark clearing', () => {
    for (const l of LANDMARKS) {
      const d = districts.find((x) => x.code === l.district)!;
      const pop = 300_000; // dense enough to fill the district
      const p = placeDistrict({ code: d.code, polygons: polygonsOf(d), center: project(d.centroid), areaKm2: d.areaKm2, population2015: pop, clearings });
      const c = clearings[LANDMARKS.indexOf(l)]!;
      for (const b of p.buildings) expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThanOrEqual(c.r);
      for (const t of p.trees) expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThanOrEqual(c.r);
    }
  }, 60_000);

  it('no street midpoint lies inside a clearing', () => {
    const urban = districts.filter((d) => ['63000020', '63000040', '63000050', '63000070', '65000010'].includes(d.code)).flatMap(polygonsOf);
    const grid = buildStreetGrid(urban, clearings);
    for (const key of grid.list) {
      const e = parseEdge(key);
      const mx = e.horizontal ? (e.i + 0.5) * SPACING : e.i * SPACING;
      const mz = e.horizontal ? e.j * SPACING : (e.j + 0.5) * SPACING;
      for (const c of clearings) expect(Math.hypot(mx - c.x, mz - c.z)).toBeGreaterThanOrEqual(c.r);
    }
  });
});
