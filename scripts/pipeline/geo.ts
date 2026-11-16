// Pure geometry helpers for the data pipeline. No file access.
// Positions are [longitude, latitude] in degrees.
import { pointInRing, type Polygon, type Position, type Ring } from '../geo/shapefile.ts';
import { keyOf } from '../geo/simplify.ts';
import { DataError } from './errors.ts';
import { codePointCompare } from './numeric.ts';

/** Authalic radius of GRS80, used for areas (same sphere as the area formula in the design). */
export const AREA_RADIUS_KM = 6371.0072;
/** Mean Earth radius, used for great-circle distances. */
export const DISTANCE_RADIUS_KM = 6371.0088;

const RAD = Math.PI / 180;

/** A district's polygons keyed by its official code. */
export interface DistrictShape {
  readonly code: string;
  readonly polygons: readonly Polygon[];
}

/**
 * Area of one ring in km², on a sphere, by spherical excess (the algorithm of d3.geoArea).
 * Edges are great-circle arcs. The result is unsigned and independent of winding order.
 */
export function ringAreaKm2(ring: Ring): number {
  if (ring.length < 3) return 0;
  const first = ring[0]!;
  let lambda0 = first[0] * RAD;
  let phi0 = (first[1] * RAD) / 2 + Math.PI / 4;
  let cosPhi0 = Math.cos(phi0);
  let sinPhi0 = Math.sin(phi0);
  let sum = 0;
  // Visit every vertex after the first, then close back to the first.
  const n = ring.length;
  const closed = first[0] === ring[n - 1]![0] && first[1] === ring[n - 1]![1];
  const last = closed ? n - 1 : n;
  for (let i = 1; i <= last; i++) {
    const p = i === last ? first : ring[i]!;
    const lambda = p[0] * RAD;
    const phi = (p[1] * RAD) / 2 + Math.PI / 4;
    const dLambda = lambda - lambda0;
    const sdLambda = dLambda >= 0 ? 1 : -1;
    const adLambda = sdLambda * dLambda;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const k = sinPhi0 * sinPhi;
    const u = cosPhi0 * cosPhi + k * Math.cos(adLambda);
    const v = k * sdLambda * Math.sin(adLambda);
    sum += Math.atan2(v, u);
    lambda0 = lambda;
    phi0 = phi;
    cosPhi0 = cosPhi;
    sinPhi0 = sinPhi;
  }
  // The half-angle trick in the loop yields half the excess.
  const steradians = Math.abs(sum) * 2;
  // A ring wound the other way around the sphere would cover the complement.
  const small = steradians > 2 * Math.PI ? 4 * Math.PI - steradians : steradians;
  return small * AREA_RADIUS_KM * AREA_RADIUS_KM;
}

/** Area of polygons in km²: exterior rings minus holes. */
export function polygonsAreaKm2(polygons: readonly Polygon[]): number {
  let total = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, i) => {
      total += (i === 0 ? 1 : -1) * ringAreaKm2(ring);
    });
  }
  return total;
}

/**
 * Area-weighted centroid in a local equirectangular frame (x scaled by cos of the mean latitude),
 * returned as [lon, lat]. Holes subtract. The result lies inside the bounding box of the input.
 */
export function centroid(polygons: readonly Polygon[]): Position {
  let latSum = 0;
  let count = 0;
  for (const ring of polygons.flat()) {
    for (const p of ring) {
      latSum += p[1];
      count++;
    }
  }
  if (count === 0) throw new DataError('centroid', 'empty geometry');
  const scale = Math.cos((latSum / count) * RAD);
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, i) => {
      const weight = i === 0 ? 1 : -1;
      let a = 0;
      let rx = 0;
      let ry = 0;
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const x0 = ring[j]![0] * scale;
        const y0 = ring[j]![1];
        const x1 = ring[k]![0] * scale;
        const y1 = ring[k]![1];
        const cross = x0 * y1 - x1 * y0;
        a += cross;
        rx += (x0 + x1) * cross;
        ry += (y0 + y1) * cross;
      }
      a /= 2;
      if (a === 0) return;
      // Ring centroid is independent of winding; its weight is the unsigned area.
      const w = weight * Math.abs(a);
      area += w;
      cx += (rx / (6 * a)) * w;
      cy += (ry / (6 * a)) * w;
    });
  }
  if (area <= 0) throw new DataError('centroid', 'geometry with no area');
  return [cx / area / scale, cy / area];
}

/** Great-circle distance in km between two [lon, lat] points. */
export function haversineKm(a: Position, b: Position): number {
  const dPhi = (b[1] - a[1]) * RAD;
  const dLambda = (b[0] - a[0]) * RAD;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLambda / 2) ** 2;
  return 2 * DISTANCE_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function inPolygon(point: Position, polygon: Polygon): boolean {
  const [exterior, ...holes] = polygon;
  if (exterior === undefined || !pointInRing(point, exterior)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

/**
 * Code of the district containing the point (exterior minus holes), or undefined when none does.
 * Throws when the point lies inside two districts.
 */
export function districtAt(point: Position, shapes: readonly DistrictShape[]): string | undefined {
  const hits = shapes.filter((s) => s.polygons.some((p) => inPolygon(point, p))).map((s) => s.code);
  if (hits.length > 1) {
    throw new DataError('district-overlap', `point [${point[0]}, ${point[1]}] lies inside ${hits.length} districts`, [
      `districts: ${hits.join(', ')}`,
    ]);
  }
  return hits[0];
}

/**
 * Districts that share at least one edge (two consecutive vertices, matched by the 7-decimal
 * vertex key). Returns every code in `shapes` mapped to its sorted neighbour codes.
 * Districts that touch only at a corner are not neighbours.
 */
export function adjacency(shapes: readonly DistrictShape[]): Map<string, string[]> {
  const edgeOwners = new Map<string, Set<string>>();
  for (const shape of shapes) {
    for (const ring of shape.polygons.flat()) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = keyOf(ring[i]!);
        const b = keyOf(ring[i + 1]!);
        if (a === b) continue;
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        const owners = edgeOwners.get(edge) ?? new Set<string>();
        owners.add(shape.code);
        edgeOwners.set(edge, owners);
      }
    }
  }
  const neighbours = new Map<string, Set<string>>(shapes.map((s) => [s.code, new Set<string>()]));
  for (const owners of edgeOwners.values()) {
    for (const x of owners) {
      for (const y of owners) if (x !== y) neighbours.get(x)!.add(y);
    }
  }
  return new Map([...neighbours].map(([code, set]) => [code, [...set].sort(codePointCompare)]));
}

/**
 * Counts edges used by exactly one ring whose two endpoints both lie on more than one feature.
 * Such edges indicate borders that do not coincide. The count should not grow after simplifying.
 */
export function mismatchedEdges(features: readonly (readonly Polygon[])[]): number {
  const owners = new Map<string, Set<number>>();
  const edges = new Map<string, number>();
  features.forEach((polys, f) => {
    for (const ring of polys.flat()) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = keyOf(ring[i]!);
        const b = keyOf(ring[i + 1]!);
        for (const k of [a, b]) owners.set(k, (owners.get(k) ?? new Set()).add(f));
        const e = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
  });
  let count = 0;
  for (const [e, n] of edges) {
    if (n !== 1) continue;
    const [a, b] = e.split('|');
    if ((owners.get(a!)?.size ?? 0) > 1 && (owners.get(b!)?.size ?? 0) > 1) count++;
  }
  return count;
}
