// Avatar collision (city-3d Requirement 8.3, task 8.1). Pure functions, no three import.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createCollider, slideMove } from '../../../src/ui/city/collision.ts';
import type { PolygonXZ } from '../../../src/ui/city/geometry.ts';

const land: PolygonXZ[] = [
  [
    [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
      [-100, -100],
    ],
  ],
];
const boxes = [
  { x: 10, z: 0, hw: 2, hd: 2 },
  { x: -20, z: 15, hw: 3, hd: 1.5 },
];
const circles = [{ x: 0, z: 30, r: 5 }];
const c = createCollider(boxes, circles, land);

describe('collider', () => {
  it('blocks inside a box, near a circle and off the land; frees open street', () => {
    expect(c.blocked(10, 0, 0.5)).toBe(true);
    expect(c.blocked(12.3, 0, 0.5)).toBe(true); // within the radius of the box edge
    expect(c.blocked(13, 0, 0.5)).toBe(false);
    expect(c.blocked(0, 26, 0.5)).toBe(true);
    expect(c.blocked(150, 0, 0.5)).toBe(true);
    expect(c.blocked(0, 0, 0.5)).toBe(false);
  });

  it('slides along a wall instead of stopping', () => {
    // Walking diagonally into the box face at x = 8: the x part is blocked, the z part is free.
    const [x, z] = slideMove(c, 7.4, -1, 0.5, 0.5, 0.5);
    expect(x).toBe(7.4);
    expect(z).toBe(-0.5);
  });

  it('Property: a move that starts free never ends blocked', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -99, max: 99, noNaN: true }),
        fc.double({ min: -99, max: 99, noNaN: true }),
        fc.array(fc.tuple(fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true })), { maxLength: 60 }),
        (x0, z0, steps) => {
          fc.pre(!c.blocked(x0, z0, 0.5));
          let x = x0;
          let z = z0;
          for (const [dx, dz] of steps) {
            [x, z] = slideMove(c, x, z, dx, dz, 0.5);
            expect(c.blocked(x, z, 0.5)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
