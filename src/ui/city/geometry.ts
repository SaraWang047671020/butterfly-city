// Plane geometry on projected rings (world units). Pure; no three import.
import type { XZ } from './projection.ts';

export type RingXZ = readonly XZ[];
/** A polygon: outer ring first, then holes. */
export type PolygonXZ = readonly RingXZ[];

/** Even-odd test of a point against one ring. */
export function inRing(x: number, z: number, ring: RingXZ): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring of a polygon and outside its holes. */
export function inPolygon(x: number, z: number, poly: PolygonXZ): boolean {
  if (poly.length === 0 || !inRing(x, z, poly[0]!)) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(x, z, poly[k]!)) return false;
  return true;
}

export function inAnyPolygon(x: number, z: number, polys: readonly PolygonXZ[]): boolean {
  return polys.some((p) => inPolygon(x, z, p));
}

export interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export function boundsOf(polys: readonly PolygonXZ[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const poly of polys) {
    for (const [x, z] of poly[0] ?? []) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX, maxX, minZ, maxZ };
}
