/**
 * Topology-preserving polygon simplification (Douglas?“Peucker on shared arcs).
 *
 * Simplifying each district on its own would move a shared border differently on each side and
 * leave gaps or overlaps between neighbors. Instead:
 *   1. Junction vertices are found: a vertex is a junction when it has more or fewer than two
 *      distinct neighbors across all rings (where three districts meet, or where a shared border
 *      meets an unshared one). Rings without junctions (islands) get two fixed vertices.
 *   2. Each ring is cut at its junctions into arcs.
 *   3. Each arc is simplified once in a canonical direction and cached, so the two rings sharing a
 *      border get the identical simplified arc.
 * This relies on neighboring rings using identical vertices along shared borders, which holds for
 * the MOI district boundary data. Pure function; inputs are not mutated.
 */
import type { Polygon, Position, Ring } from './shapefile.ts';
import { signedArea } from './shapefile.ts';

export interface SimplifyOptions {
  /** Douglas?“Peucker tolerance in meters. */
  readonly toleranceMeters: number;
  /** Coordinate decimals in the output (5 ??1 m). */
  readonly decimals: number;
}

export const keyOf = ([x, y]: Position) => `${x.toFixed(7)},${y.toFixed(7)}`;

/** Open ring (drops the closing vertex when it repeats the first). */
function open(ring: Ring): Position[] {
  const pts = [...ring];
  if (pts.length > 1 && keyOf(pts[0]!) === keyOf(pts[pts.length - 1]!)) pts.pop();
  return pts;
}

/** Douglas?“Peucker on a polyline in meters (equirectangular around the polyline's latitude). */
export function douglasPeucker(points: readonly Position[], toleranceMeters: number): Position[] {
  if (points.length <= 2) return [...points];
  const lat = (points[0]![1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(lat);
  const my = 110_574;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = (bx - ax) * mx;
    const dy = (by - ay) * my;
    const len2 = dx * dx + dy * dy;
    let maxDist = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const px = (points[i]![0] - ax) * mx;
      const py = (points[i]![1] - ay) * my;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxDist) {
        maxDist = d2;
        index = i;
      }
    }
    if (index >= 0 && maxDist > toleranceMeters * toleranceMeters) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplifies a set of features (each a list of polygons) so shared borders stay identical. */
export function simplifyTopology(features: readonly (readonly Polygon[])[], options: SimplifyOptions): Polygon[][] {
  const rings = features.flatMap((polys) => polys.flatMap((poly) => poly.map(open)));

  // 1. Neighbor sets per vertex across all rings.
  const neighbors = new Map<string, Set<string>>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const k = keyOf(ring[i]!);
      const set = neighbors.get(k) ?? new Set<string>();
      neighbors.set(k, set);
      set.add(keyOf(ring[(i + ring.length - 1) % ring.length]!));
      set.add(keyOf(ring[(i + 1) % ring.length]!));
    }
  }
  const isJunction = (p: Position) => neighbors.get(keyOf(p))!.size !== 2;

  // 2??. Cut rings at junctions, simplify arcs canonically, and cache by arc signature.
  const cache = new Map<string, Position[]>();
  const simplifyArc = (arc: Position[]): Position[] => {
    const keys = arc.map(keyOf);
    const forward = keys[0]! < keys[keys.length - 1]! || (keys[0] === keys[keys.length - 1] && keys[1]! <= keys[keys.length - 2]!);
    const canonical = forward ? arc : [...arc].reverse();
    const ck = canonical.map(keyOf);
    const signature = `${ck[0]}|${ck[1]}|${ck.length}|${ck[ck.length - 2]}|${ck[ck.length - 1]}`;
    let simplified = cache.get(signature);
    if (!simplified) {
      simplified = douglasPeucker(canonical, options.toleranceMeters);
      cache.set(signature, simplified);
    }
    return forward ? simplified : [...simplified].reverse();
  };

  const factor = 10 ** options.decimals;
  const round = ([x, y]: Position): Position => [Math.round(x * factor) / factor, Math.round(y * factor) / factor];

  const simplifyRing = (ring: Position[]): Position[] | null => {
    let fixed = ring.map((p, i) => (isJunction(p) ? i : -1)).filter((i) => i >= 0);
    if (fixed.length === 0) {
      // Island ring: fix the first vertex and the vertex farthest from it.
      const [x0, y0] = ring[0]!;
      let far = 0;
      let best = -1;
      ring.forEach(([x, y], i) => {
        const d = (x - x0) ** 2 + (y - y0) ** 2;
        if (d > best) {
          best = d;
          far = i;
        }
      });
      fixed = far === 0 ? [0] : [0, far];
    }
    const out: Position[] = [];
    for (let f = 0; f < fixed.length; f++) {
      const start = fixed[f]!;
      const end = fixed[(f + 1) % fixed.length]!;
      const arc: Position[] = [];
      for (let i = start; ; i = (i + 1) % ring.length) {
        arc.push(ring[i]!);
        if (arc.length > 1 && i === end) break;
      }
      const s = simplifyArc(arc);
      out.push(...s.slice(0, -1));
    }
    const rounded = out.map(round).filter((p, i, a) => i === 0 || keyOf(p) !== keyOf(a[i - 1]!));
    if (rounded.length < 3) return null;
    return [...rounded, rounded[0]!];
  };

  return features.map((polys) => {
    const result: Polygon[] = [];
    for (const poly of polys) {
      const exterior = simplifyRing(open(poly[0]!));
      if (!exterior) continue; // collapsed small island
      const holes = poly.slice(1).map((h) => simplifyRing(open(h))).filter((h): h is Position[] => h !== null);
      result.push([exterior, ...holes]);
    }
    if (result.length === 0 && polys.length > 0) {
      // Never drop a whole feature: keep its largest polygon unsimplified (rounded only).
      const largest = [...polys].sort((a, b) => Math.abs(signedArea(b[0]!)) - Math.abs(signedArea(a[0]!)))[0]!;
      result.push(largest.map((r) => r.map(round)));
    }
    return result;
  });
}
