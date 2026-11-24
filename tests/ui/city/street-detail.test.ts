// Street detail near the Avatar (city-3d Requirement 14, task 11). Pure placement, no three import.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { boxCollider, createCollider, slideMove, unionCollider } from '../../../src/ui/city/collision.ts';
import type { PolygonXZ } from '../../../src/ui/city/geometry.ts';
import { hashSeed, mulberry32 } from '../../../src/ui/city/random.ts';
import {
  buildingDetail,
  detailNear,
  indexBuildings,
  KERB,
  LAMP_HEIGHT,
  obstaclesClearOf,
  SIGN_BASE,
  type DetailBox,
  type DetailBuilding,
  type DetailQuery,
} from '../../../src/ui/city/street-detail.ts';
import { buildStreetGrid, clearOfStreets, gridDist, ROAD_HALF_WIDTH, SPACING } from '../../../src/ui/city/street-grid.ts';

const HALF = 130;
const square: PolygonXZ[] = [
  [
    [
      [-HALF, -HALF],
      [HALF, -HALF],
      [HALF, HALF],
      [-HALF, HALF],
      [-HALF, -HALF],
    ],
  ],
];
const grid = buildStreetGrid(square);

/** Buildings placed like placement.ts: inside the square and clear of every grid street. */
function town(seed: number, count = 600): DetailBuilding[] {
  const rand = mulberry32(seed);
  const out: DetailBuilding[] = [];
  for (let k = 0; out.length < count && k < count * 40; k++) {
    const x = (rand() * 2 - 1) * (HALF - 10);
    const z = (rand() * 2 - 1) * (HALF - 10);
    const hw = (2.2 + rand() * 2.4) / 2;
    const hd = (2.2 + rand() * 2.4) / 2;
    if (clearOfStreets(x, z, hw, hd)) out.push({ x, z, hw, hd });
  }
  return out;
}

const heights = (buildings: readonly DetailBuilding[], seed: number) => {
  const rand = mulberry32(seed);
  return buildings.map(() => 1 + rand() * 20);
};

function query(buildings: readonly DetailBuilding[], h: readonly number[], avoid: DetailQuery['avoid'] = []): DetailQuery {
  return { buildings, index: indexBuildings(buildings), grid, avoid, heightOf: (i) => h[i]! };
}

const extent = (b: DetailBox, axis: 'x' | 'z') => {
  const c = axis === 'x' ? b.x : b.z;
  const s = (axis === 'x' ? b.sx : b.sz) / 2;
  return [c - s, c + s] as const;
};

/** Distance from an interval to the nearest grid line; 0 when the interval crosses one. */
function lineDistance(lo: number, hi: number): number {
  if (Math.floor(lo / SPACING) !== Math.floor(hi / SPACING)) return 0;
  return Math.min(gridDist(lo), gridDist(hi));
}

const seeds = fc.integer({ min: 1, max: 2 ** 31 - 1 });

describe('street detail placement (city-3d 14)', () => {
  it('finds detail in a town', () => {
    const b = town(7);
    const d = detailNear(query(b, heights(b, 7)), 0, 0, 60);
    for (const kind of ['shop', 'slab', 'column', 'sign', 'band', 'pole', 'arm', 'lamp']) {
      expect(d.boxes.some((x) => x.kind === kind), kind).toBe(true);
    }
    expect(d.glows.length).toBe(d.boxes.filter((x) => x.kind === 'lamp').length);
  });

  it('is deterministic, and a building or street shows the same detail wherever the Avatar stands (14.2)', () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }), (seed, dx, dz) => {
        const b = town(seed, 200);
        const q = query(b, heights(b, seed));
        const a = detailNear(q, 0, 0, 30);
        expect(detailNear(q, 0, 0, 30)).toEqual(a);
        // Seen from a shifted point with a radius that covers the first circle, every item of the first is there.
        const wide = detailNear(q, dx, dz, 30 + Math.hypot(dx, dz) + SPACING);
        const key = (x: DetailBox) => JSON.stringify(x);
        const all = new Set(wide.boxes.map(key));
        expect(a.boxes.filter((x) => !all.has(key(x)))).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it('keeps shopfronts, arcade slabs and columns off the road and out of the kerb strip (14.3)', () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const b = town(seed, 300);
        const d = detailNear(query(b, heights(b, seed)), 0, 0, 90);
        for (const box of d.boxes.filter((x) => x.kind === 'shop' || x.kind === 'slab' || x.kind === 'column')) {
          for (const axis of ['x', 'z'] as const) {
            const [lo, hi] = extent(box, axis);
            expect(lineDistance(lo, hi)).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH + KERB - 1e-9);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('keeps signs between the first floor and the roof, and the lamp arms below every sign (14.4)', () => {
    fc.assert(
      fc.property(seeds, fc.double({ min: 0.5, max: 30, noNaN: true }), (seed, height) => {
        const [b] = town(seed, 1);
        const out: DetailBox[] = [];
        buildingDetail(b!, height, grid, out);
        for (const s of out.filter((x) => x.kind === 'sign')) {
          expect(s.y - s.sy / 2).toBeGreaterThanOrEqual(SIGN_BASE - 1e-9);
          expect(s.y + s.sy / 2).toBeLessThanOrEqual(height + 1e-9);
        }
        for (const x of out) expect(x.y + x.sy / 2).toBeLessThanOrEqual(height + 1e-9);
      }),
      { numRuns: 200 },
    );
    expect(LAMP_HEIGHT + 0.03).toBeLessThan(SIGN_BASE);
  });

  it('puts street lights only on streets of the grid, never in a building or a station circle (14.3)', () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const b = town(seed, 300);
        const avoid = [{ x: 0, z: 0, r: 6 }];
        const d = detailNear(query(b, heights(b, seed), avoid), 0, 0, 90);
        const bad: string[] = [];
        for (const p of d.boxes.filter((x) => x.kind === 'pole')) {
          // On the kerb of a street: next to a grid line along one axis.
          const onX = Math.abs(gridDist(p.x) - (ROAD_HALF_WIDTH - KERB)) < 1e-6;
          const onZ = Math.abs(gridDist(p.z) - (ROAD_HALF_WIDTH - KERB)) < 1e-6;
          const i = onX ? Math.round(p.x / SPACING) : Math.floor(p.x / SPACING);
          const j = onX ? Math.floor(p.z / SPACING) : Math.round(p.z / SPACING);
          if (!(onX || onZ)) bad.push(`off kerb ${p.x},${p.z}`);
          else if (!grid.edges.has(onX ? `v${i},${j}` : `h${i},${j}`)) bad.push(`no street ${p.x},${p.z}`);
          if (b.some((h) => Math.abs(p.x - h.x) < h.hw && Math.abs(p.z - h.z) < h.hd)) bad.push(`in building ${p.x},${p.z}`);
          if (Math.hypot(p.x, p.z) < 7) bad.push(`in station ${p.x},${p.z}`);
        }
        expect(bad).toEqual([]);
      }),
      { numRuns: 15 },
    );
  });

  it('gives every column and lamp pole as an obstacle (user decision B2)', () => {
    const b = town(11);
    const d = detailNear(query(b, heights(b, 11)), 0, 0, 60);
    const posts = d.boxes.filter((x) => x.kind === 'column' || x.kind === 'pole');
    expect(d.obstacles.length).toBe(posts.length);
    expect(d.obstacles.length).toBeGreaterThan(0);
  });

  it('never adds an obstacle on top of the Avatar, so a slide move from the Avatar stays free (14.6)', () => {
    const land = square;
    const base = createCollider([], [], land);
    fc.assert(
      fc.property(seeds, fc.double({ min: -100, max: 100, noNaN: true }), fc.double({ min: -100, max: 100, noNaN: true }), (seed, x, z) => {
        const b = town(seed, 300);
        const d = detailNear(query(b, heights(b, seed)), x, z, 30);
        const extra = boxCollider(obstaclesClearOf(d.obstacles, x, z, 0.5));
        const c = unionCollider(base, () => extra);
        expect(c.blocked(x, z, 0.5)).toBe(false);
        const rand = mulberry32(hashSeed(`${seed}`));
        let p: readonly [number, number] = [x, z];
        for (let k = 0; k < 40; k++) {
          p = slideMove(c, p[0], p[1], (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8, 0.5);
          expect(c.blocked(p[0], p[1], 0.5)).toBe(false);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('the building index returns exactly the buildings within the radius', () => {
    fc.assert(
      fc.property(seeds, fc.double({ min: -120, max: 120, noNaN: true }), fc.double({ min: 0, max: 80, noNaN: true }), (seed, x, r) => {
        const b = town(seed, 300);
        const brute = b.flatMap((h, i) => (Math.hypot(h.x - x, h.z) <= r ? [i] : []));
        expect(indexBuildings(b).near(x, 0, r)).toEqual(brute);
      }),
      { numRuns: 50 },
    );
  });
});

describe('box collider and union collider', () => {
  it('a box collider blocks inside its boxes only; the union blocks where either does', () => {
    const boxes = boxCollider([{ x: 0, z: 0, hw: 1, hd: 1 }]);
    expect(boxes.blocked(0, 0, 0.1)).toBe(true);
    expect(boxes.blocked(1.4, 0, 0.5)).toBe(true);
    expect(boxes.blocked(1.6, 0, 0.5)).toBe(false);
    let extra = boxCollider([]);
    const u = unionCollider(boxes, () => extra);
    expect(u.blocked(5, 5, 0.5)).toBe(false);
    extra = boxCollider([{ x: 5, z: 5, hw: 0.1, hd: 0.1 }]);
    expect(u.blocked(5, 5, 0.5)).toBe(true);
  });
});
