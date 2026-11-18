// Illustrative buildings and trees per district (city-3d 4.2, 4.4, 4.6). Pure and deterministic.
import { boundsOf, inAnyPolygon, type PolygonXZ } from './geometry.ts';
import { hashSeed, mulberry32 } from './random.ts';
import { clearOfStreets, gridDist, ROAD_HALF_WIDTH, URBAN_DENSITY } from './street-grid.ts';

export const PERSONS_PER_BUILDING = 1400;
const MAX_TREES = 1400;

export interface PlacementInput {
  readonly code: string;
  readonly polygons: readonly PolygonXZ[];
  readonly center: readonly [number, number];
  readonly areaKm2: number;
  readonly population2015: number;
  /** Circles kept free of buildings and trees (Landmarks, city-3d 7.2). */
  readonly clearings?: readonly { readonly x: number; readonly z: number; readonly r: number }[];
}

export interface BuildingSpot {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  /** Base height before the Price_Index scale. */
  readonly height: number;
  /** Brightness factor 0.55–1 for the instance colour. */
  readonly shade: number;
}

export interface TreeSpot {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly stretch: number;
}

export interface Placement {
  readonly urban: boolean;
  readonly buildings: readonly BuildingSpot[];
  readonly trees: readonly TreeSpot[];
}

export const densityOf = (p: PlacementInput): number => (p.areaKm2 > 0 ? p.population2015 / p.areaKm2 : 0);
export const isUrban = (p: PlacementInput): boolean => densityOf(p) > URBAN_DENSITY;

/** Buildings and trees of one district, from a seed derived from its code. */
export function placeDistrict(p: PlacementInput): Placement {
  const rand = mulberry32(hashSeed(p.code));
  const density = densityOf(p);
  const urban = density > URBAN_DENSITY;
  const b = boundsOf(p.polygons);
  const inside = (x: number, z: number) => inAnyPolygon(x, z, p.polygons);
  const clear = (x: number, z: number, half: number) => (p.clearings ?? []).every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + half);
  const count = Math.round(p.population2015 / PERSONS_PER_BUILDING);
  // Buildings cluster toward the centre, so mountain districts keep a small town in open forest.
  const spread = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (density > 5000 ? 0.6 : 0.18);
  const heightFactor = 0.5 + Math.min(density, 40000) / 50000;

  const buildings: BuildingSpot[] = [];
  for (let tries = 0; buildings.length < count && tries < count * 60; tries++) {
    const x = p.center[0] + (rand() + rand() + rand() - 1.5) * spread;
    const z = p.center[1] + (rand() + rand() + rand() - 1.5) * spread;
    const width = 2.2 + rand() * 2.4;
    const depth = 2.2 + rand() * 2.4;
    const height = (2 + Math.pow(rand(), 3.5) * 24) * heightFactor;
    const shade = 0.55 + rand() * 0.45;
    if (!inside(x, z)) continue;
    if (urban && !clearOfStreets(x, z, width / 2, depth / 2)) continue;
    if (!clear(x, z, Math.hypot(width, depth) / 2)) continue;
    buildings.push({ x, z, width, depth, height, shade });
  }

  const treeCount = Math.min(MAX_TREES, Math.round(p.areaKm2 * (density < 3000 ? 9 : 1.5)));
  const trees: TreeSpot[] = [];
  for (let k = 0; trees.length < treeCount && k < treeCount * 8; k++) {
    const x = b.minX + rand() * (b.maxX - b.minX);
    const z = b.minZ + rand() * (b.maxZ - b.minZ);
    const size = 1.5 + rand() * 2.5;
    const stretch = 1.6 + rand();
    if (!inside(x, z)) continue;
    if (urban && (gridDist(x) < ROAD_HALF_WIDTH + 1 || gridDist(z) < ROAD_HALF_WIDTH + 1)) continue;
    if (!clear(x, z, size / 2)) continue;
    trees.push({ x, z, size, stretch });
  }
  return { urban, buildings, trees };
}

/** Height scale of a district from its Price_Index (city-3d 4.3). */
export function heightScale(priceIndex: number | null): number {
  if (priceIndex === null || !Number.isFinite(priceIndex)) return 1;
  return Math.min(1.8, Math.max(0.6, priceIndex));
}
