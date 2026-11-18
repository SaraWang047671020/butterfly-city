// Street_Grid of the Urban_Districts (city-3d 4.4). Axis-aligned in world space.
// A node is (i, j) at world (i × SPACING, j × SPACING). Edge 'h' i,j joins (i, j)–(i+1, j); edge 'v' i,j joins (i, j)–(i, j+1).
import { boundsOf, inAnyPolygon, type PolygonXZ } from './geometry.ts';

export const SPACING = 13;
export const ROAD_HALF_WIDTH = 1.4;
/** Persons per km² above which a district is an Urban_District. */
export const URBAN_DENSITY = 2500;

/** Distance from a coordinate to the nearest grid line along one axis. */
export function gridDist(a: number): number {
  const m = ((a % SPACING) + SPACING) % SPACING;
  return Math.min(m, SPACING - m);
}

export type EdgeKey = string;
export const edgeKey = (i: number, j: number, horizontal: boolean): EdgeKey => `${horizontal ? 'h' : 'v'}${i},${j}`;

export interface Edge {
  readonly i: number;
  readonly j: number;
  readonly horizontal: boolean;
}

export function parseEdge(key: EdgeKey): Edge {
  const [i, j] = key.slice(1).split(',').map(Number) as [number, number];
  return { i, j, horizontal: key.startsWith('h') };
}

export interface StreetGrid {
  readonly edges: ReadonlySet<EdgeKey>;
  /** Edge keys in a fixed order (ascending i, then j, h before v). */
  readonly list: readonly EdgeKey[];
}

/** Every edge whose midpoint lies inside one of the urban polygons and outside every clearing (Landmarks). */
export function buildStreetGrid(
  urban: readonly PolygonXZ[],
  clearings: readonly { readonly x: number; readonly z: number; readonly r: number }[] = [],
): StreetGrid {
  const open = (x: number, z: number) => clearings.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + ROAD_HALF_WIDTH);
  const list: EdgeKey[] = [];
  if (urban.length > 0) {
    const b = boundsOf(urban);
    const i0 = Math.floor(b.minX / SPACING) - 1;
    const i1 = Math.ceil(b.maxX / SPACING) + 1;
    const j0 = Math.floor(b.minZ / SPACING) - 1;
    const j1 = Math.ceil(b.maxZ / SPACING) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const hx = (i + 0.5) * SPACING, hz = j * SPACING, vx = i * SPACING, vz = (j + 0.5) * SPACING;
        if (inAnyPolygon(hx, hz, urban) && open(hx, hz)) list.push(edgeKey(i, j, true));
        if (inAnyPolygon(vx, vz, urban) && open(vx, vz)) list.push(edgeKey(i, j, false));
      }
    }
  }
  return { edges: new Set(list), list };
}

/** Whether the street leaving node (i, j) in direction (di, dj) exists. */
export function hasStreet(grid: StreetGrid, i: number, j: number, di: number, dj: number): boolean {
  if (di !== 0) return grid.edges.has(edgeKey(di > 0 ? i : i - 1, j, true));
  return grid.edges.has(edgeKey(i, dj > 0 ? j : j - 1, false));
}

/** Whether a footprint of half sizes (hw, hd) centred at (x, z) keeps clear of every grid street. */
export function clearOfStreets(x: number, z: number, hw: number, hd: number, margin = 0.3): boolean {
  return gridDist(x) >= hw + ROAD_HALF_WIDTH + margin && gridDist(z) >= hd + ROAD_HALF_WIDTH + margin;
}
