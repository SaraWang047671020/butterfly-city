// Avatar collision against building footprints, Landmark circles and the coast (city-3d Requirement 8.3). Pure.
import { inAnyPolygon, type PolygonXZ } from './geometry.ts';

export interface BoxFootprint {
  readonly x: number;
  readonly z: number;
  readonly hw: number; // half width along x
  readonly hd: number; // half depth along z
}

export interface CircleFootprint {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

export interface Collider {
  /** Whether a circle of `radius` at (x, z) overlaps a footprint or leaves the land. */
  blocked(x: number, z: number, radius: number): boolean;
}

const CELL = 8;
const cellKey = (i: number, j: number) => `${i},${j}`;

export function createCollider(boxes: readonly BoxFootprint[], circles: readonly CircleFootprint[], land: readonly PolygonXZ[]): Collider {
  // Spatial hash of the boxes so that a test looks at a few boxes only.
  const cells = new Map<string, BoxFootprint[]>();
  for (const b of boxes) {
    for (let i = Math.floor((b.x - b.hw) / CELL); i <= Math.floor((b.x + b.hw) / CELL); i++) {
      for (let j = Math.floor((b.z - b.hd) / CELL); j <= Math.floor((b.z + b.hd) / CELL); j++) {
        const k = cellKey(i, j);
        const list = cells.get(k);
        if (list === undefined) cells.set(k, [b]);
        else list.push(b);
      }
    }
  }
  return {
    blocked(x, z, radius) {
      if (!inAnyPolygon(x, z, land)) return true;
      for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
      for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++) {
        for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) {
          for (const b of cells.get(cellKey(i, j)) ?? []) {
            // Distance from the circle centre to the box.
            const dx = Math.max(Math.abs(x - b.x) - b.hw, 0);
            const dz = Math.max(Math.abs(z - b.z) - b.hd, 0);
            if (dx * dx + dz * dz < radius * radius) return true;
          }
        }
      }
      return false;
    },
  };
}

/**
 * Moves from (x, z) by (dx, dz) and slides along an obstacle: the full move if it is free, otherwise the x part or
 * the z part alone if one of them is free, otherwise no move. The result is never blocked when the start is free.
 */
export function slideMove(c: Collider, x: number, z: number, dx: number, dz: number, radius: number): readonly [number, number] {
  if (!c.blocked(x + dx, z + dz, radius)) return [x + dx, z + dz];
  if (dx !== 0 && !c.blocked(x + dx, z, radius)) return [x + dx, z];
  if (dz !== 0 && !c.blocked(x, z + dz, radius)) return [x, z + dz];
  return [x, z];
}
