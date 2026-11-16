import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { centroid, districtAt, polygonsAreaKm2, type DistrictShape } from "../../../scripts/pipeline/geo.ts";
import type { Polygon, Position, Ring } from "../../../scripts/geo/shapefile.ts";

const NUM_RUNS = 200;

function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

function reversed(ring: Ring): Ring {
  return [...ring].reverse();
}

interface Scenario {
  shapes: DistrictShape[];
  point: Position;
  expected: string;
}

const HOLE_LO = 0.3;
const HOLE_HI = 0.7;

// A grid of rectangular districts. Some cells hold a hole filled by another district.
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    cols: fc.integer({ min: 1, max: 4 }),
    rows: fc.integer({ min: 1, max: 4 }),
    x0: fc.double({ min: 121.2, max: 121.5, noNaN: true }),
    y0: fc.double({ min: 24.6, max: 24.9, noNaN: true }),
    w: fc.double({ min: 0.02, max: 0.1, noNaN: true }),
    h: fc.double({ min: 0.02, max: 0.1, noNaN: true }),
  })
  .chain((g) =>
    fc.record({
      g: fc.constant(g),
      hosts: fc.array(fc.boolean(), { minLength: g.cols * g.rows, maxLength: g.cols * g.rows }),
      cell: fc.integer({ min: 0, max: g.cols * g.rows - 1 }),
      inHole: fc.boolean(),
      fx: fc.double({ min: 0, max: 1, noNaN: true }),
      fy: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  )
  .map(({ g, hosts, cell, inHole, fx, fy }) => {
    const shapes: DistrictShape[] = [];
    let point: Position = [0, 0];
    let expected = "";
    for (let idx = 0; idx < g.cols * g.rows; idx++) {
      const cx0 = g.x0 + (idx % g.cols) * g.w;
      const cy0 = g.y0 + Math.floor(idx / g.cols) * g.h;
      const cx1 = cx0 + g.w;
      const cy1 = cy0 + g.h;
      const code = `C${idx}`;
      const host = hosts[idx] === true;
      const hx0 = cx0 + HOLE_LO * g.w;
      const hx1 = cx0 + HOLE_HI * g.w;
      const hy0 = cy0 + HOLE_LO * g.h;
      const hy1 = cy0 + HOLE_HI * g.h;
      const polygon: Polygon = host ? [rect(cx0, cy0, cx1, cy1), reversed(rect(hx0, hy0, hx1, hy1))] : [rect(cx0, cy0, cx1, cy1)];
      shapes.push({ code, polygons: [polygon] });
      if (host) shapes.push({ code: `H${idx}`, polygons: [[rect(hx0, hy0, hx1, hy1)]] });
      if (idx !== cell) continue;
      if (host && inHole) {
        // Strictly inside the hole district.
        point = [hx0 + (0.1 + 0.8 * fx) * (hx1 - hx0), hy0 + (0.1 + 0.8 * fy) * (hy1 - hy0)];
        expected = `H${idx}`;
      } else if (host) {
        // In the margin below the hole, strictly inside the cell and outside the hole.
        point = [cx0 + (0.05 + 0.9 * fx) * g.w, cy0 + (0.05 + 0.2 * fy) * g.h];
        expected = code;
      } else {
        point = [cx0 + (0.05 + 0.9 * fx) * g.w, cy0 + (0.05 + 0.9 * fy) * g.h];
        expected = code;
      }
    }
    return { shapes, point, expected };
  });

// A star-shaped polygon around a centre: increasing angles with bounded jitter keep it simple.
const polygonArb: fc.Arbitrary<{ polygon: Polygon; exterior: Ring }> = fc
  .record({
    n: fc.integer({ min: 3, max: 12 }),
    lon: fc.double({ min: 121.3, max: 122.0, noNaN: true }),
    lat: fc.double({ min: 24.7, max: 25.2, noNaN: true }),
    withHole: fc.boolean(),
  })
  .chain((s) =>
    fc.record({
      s: fc.constant(s),
      jitter: fc.array(fc.double({ min: -0.4, max: 0.4, noNaN: true }), { minLength: s.n, maxLength: s.n }),
      radii: fc.array(fc.double({ min: 0.02, max: 0.08, noNaN: true }), { minLength: s.n, maxLength: s.n }),
    }),
  )
  .map(({ s, jitter, radii }) => {
    const step = (2 * Math.PI) / s.n;
    const ring = (scale: number): Position[] =>
      Array.from({ length: s.n }, (_, i): Position => {
        const a = (i + jitter[i]!) * step;
        const r = radii[i]! * scale;
        return [s.lon + r * Math.cos(a), s.lat + r * Math.sin(a)];
      });
    const outer = ring(1);
    const exterior: Ring = [...outer, outer[0]!];
    if (!s.withHole) return { polygon: [exterior] as Polygon, exterior };
    const inner = ring(0.3).reverse();
    return { polygon: [exterior, [...inner, inner[0]!]] as Polygon, exterior };
  });

describe("pipeline geometry helpers: properties", () => {
  // Feature: data-pipeline, Property 13: Point-in-polygon district lookup
  // **Validates: Requirements 11.1**
  it("Property 13: districtAt returns the district of the cell that contains the point", () => {
    fc.assert(
      fc.property(scenarioArb, ({ shapes, point, expected }) => {
        expect(districtAt(point, shapes)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 19: Area and centroid of district shapes
  // **Validates: Requirements 3.2**
  it("Property 19: area is positive and the rounded centroid lies in the exterior bounding box", () => {
    fc.assert(
      fc.property(polygonArb, ({ polygon, exterior }) => {
        expect(polygonsAreaKm2([polygon])).toBeGreaterThan(0);
        const [cx, cy] = centroid([polygon]);
        const rx = Math.round(cx * 1e5) / 1e5;
        const ry = Math.round(cy * 1e5) / 1e5;
        const xs = exterior.map((p) => p[0]);
        const ys = exterior.map((p) => p[1]);
        expect(rx).toBeGreaterThanOrEqual(Math.min(...xs));
        expect(rx).toBeLessThanOrEqual(Math.max(...xs));
        expect(ry).toBeGreaterThanOrEqual(Math.min(...ys));
        expect(ry).toBeLessThanOrEqual(Math.max(...ys));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
