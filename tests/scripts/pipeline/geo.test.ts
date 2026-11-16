import { describe, expect, it } from "vitest";
import type { Polygon, Ring } from "../../../scripts/geo/shapefile.ts";
import {
  adjacency,
  AREA_RADIUS_KM,
  centroid,
  districtAt,
  haversineKm,
  mismatchedEdges,
  ringAreaKm2,
  type DistrictShape,
} from "../../../scripts/pipeline/geo.ts";

/** Clockwise square ring (exterior convention of the shapefile reader). */
const square = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
  [x0, y0],
];
const poly = (...rings: Ring[]): Polygon => rings;

describe("ringAreaKm2", () => {
  it("matches the spherical formula for a 1 degree cell at the equator", () => {
    const expected = AREA_RADIUS_KM ** 2 * (Math.PI / 180) * 2 * Math.sin(0.5 * (Math.PI / 180));
    const area = ringAreaKm2(square(0, -0.5, 1, 0.5));
    expect(area).toBeGreaterThan(12300);
    expect(area).toBeLessThan(12400);
    expect(Math.abs(area / expected - 1)).toBeLessThan(1e-4);
  });

  it("does not depend on winding order", () => {
    const ring = square(121, 25, 121.1, 25.1);
    expect(ringAreaKm2([...ring].reverse())).toBeCloseTo(ringAreaKm2(ring), 6);
  });

  it("returns 0 for a degenerate ring", () => {
    expect(ringAreaKm2([[0, 0], [1, 1]])).toBe(0);
  });
});

describe("centroid", () => {
  it("is the middle of a square and inside the bounding box of an L shape", () => {
    const [x, y] = centroid([poly(square(121, 25, 121.2, 25.2))]);
    expect(x).toBeCloseTo(121.1, 6);
    expect(y).toBeCloseTo(25.1, 6);
    const l: Ring = [[0, 0], [0, 2], [1, 2], [1, 1], [2, 1], [2, 0], [0, 0]];
    const [lx, ly] = centroid([poly(l)]);
    expect(lx).toBeGreaterThan(0);
    expect(lx).toBeLessThan(2);
    expect(ly).toBeGreaterThan(0);
    expect(ly).toBeLessThan(2);
  });

  it("moves away from a hole", () => {
    const [x] = centroid([poly(square(0, 0, 4, 4), square(2.5, 1, 3.5, 3))]);
    expect(x).toBeLessThan(2);
  });
});

describe("haversineKm", () => {
  it("is 0 for identical points", () => {
    expect(haversineKm([121.5, 25], [121.5, 25])).toBe(0);
  });

  it("is about 111.2 km for one degree of latitude", () => {
    expect(haversineKm([121, 25], [121, 26])).toBeCloseTo((Math.PI / 180) * 6371.0088, 6);
  });

  it("gives about 25 km between Taipei Main Station and Banqiao Station", () => {
    const d = haversineKm([121.5170, 25.0478], [121.4626, 25.0143]);
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(8);
  });
});

describe("districtAt", () => {
  const shapes: DistrictShape[] = [
    { code: "A", polygons: [poly(square(0, 0, 3, 3), square(1, 1, 2, 2))] },
    { code: "B", polygons: [poly(square(1, 1, 2, 2))] },
    { code: "C", polygons: [poly(square(3, 0, 4, 3))] },
  ];

  it("finds the district of a point, respecting holes", () => {
    expect(districtAt([0.5, 0.5], shapes)).toBe("A");
    expect(districtAt([1.5, 1.5], shapes)).toBe("B");
    expect(districtAt([3.5, 1], shapes)).toBe("C");
  });

  it("returns undefined outside every district", () => {
    expect(districtAt([10, 10], shapes)).toBeUndefined();
  });

  it("throws when a point is inside two districts", () => {
    const overlapping: DistrictShape[] = [
      { code: "A", polygons: [poly(square(0, 0, 2, 2))] },
      { code: "B", polygons: [poly(square(1, 1, 3, 3))] },
    ];
    expect(() => districtAt([1.5, 1.5], overlapping)).toThrow(/2 districts/);
  });
});

describe("adjacency", () => {
  it("links districts that share an edge", () => {
    const result = adjacency([
      { code: "A", polygons: [poly(square(0, 0, 1, 1))] },
      { code: "B", polygons: [poly(square(1, 0, 2, 1))] },
    ]);
    expect(result.get("A")).toEqual(["B"]);
    expect(result.get("B")).toEqual(["A"]);
  });

  it("does not link districts that touch only at a corner", () => {
    const result = adjacency([
      { code: "A", polygons: [poly(square(0, 0, 1, 1))] },
      { code: "B", polygons: [poly(square(1, 1, 2, 2))] },
    ]);
    expect(result.get("A")).toEqual([]);
    expect(result.get("B")).toEqual([]);
  });
});

describe("mismatchedEdges", () => {
  it("is 0 when borders coincide", () => {
    expect(mismatchedEdges([[poly(square(0, 0, 1, 1))], [poly(square(1, 0, 2, 1))]])).toBe(0);
  });

  it("counts an edge that is split differently on the two sides", () => {
    // A's right side is one edge (1,0)-(1,1); B splits it at (1,0.5). Both endpoints of A's edge are
    // shared with B, but the edge itself is used once, so it is counted. B's two halves are not,
    // because (1,0.5) belongs to B only.
    const b: Ring = [[1, 0], [1, 0.5], [1, 1], [2, 1], [2, 0], [1, 0]];
    expect(mismatchedEdges([[poly(square(0, 0, 1, 1))], [poly(b)]])).toBe(1);
  });
});