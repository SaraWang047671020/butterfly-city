/**
 * Builds public/data/boundaries.geojson from the MOI district shapefile in data/raw/boundaries/:
 * the 41 Taipei and New Taipei districts, simplified with shared borders kept identical.
 *
 *   node scripts/build-boundaries.ts [--tolerance=40] [--decimals=5]
 *
 * Winding order: exterior rings clockwise, holes counterclockwise (the d3-geo convention, and the
 * shapefile's own order). RFC 7946 recommends the opposite; d3-geo would then fill the whole globe.
 * Feature properties: code (official TOWNCODE), name (romanized), city.
 */
import fs from 'node:fs';
import path from 'node:path';
import { signedArea, type Polygon } from './geo/shapefile.ts';
import { simplifyTopology } from './geo/simplify.ts';
import { DISTRICTS } from './lib/districts.ts';
import { PUBLIC_DATA } from './lib/paths.ts';
import { readDistrictShapes } from './sources/boundaries.ts';

const flag = (name: string, fallback: number) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split('=')[1]) : fallback;
};
const toleranceMeters = flag('tolerance', 40);
const decimals = flag('decimals', 5);

const keyOf = ([x, y]: readonly [number, number]) => `${x.toFixed(7)},${y.toFixed(7)}`;

/**
 * Counts edges used by exactly one ring whose two endpoints both lie on more than one district.
 * Such edges indicate borders that do not coincide. The count should not grow after simplifying.
 */
function mismatchedEdges(features: readonly (readonly Polygon[])[]): number {
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

const area = (polys: readonly Polygon[]) =>
  polys.reduce((s, p) => s + Math.abs(signedArea(p[0]!)) - p.slice(1).reduce((h, r) => h + Math.abs(signedArea(r)), 0), 0);
const pointCount = (features: readonly (readonly Polygon[])[]) => features.reduce((s, f) => s + f.flat(2).length, 0);

const { base, records } = readDistrictShapes();
if (records.length !== DISTRICTS.length) throw new Error(`expected 41 districts, found ${records.length}`);
const input = records.map((r) => r.polygons);
const output = simplifyTopology(input, { toleranceMeters, decimals });

const features = records.map((r, i) => {
  const d = DISTRICTS.find((x) => x.code === r.attributes['TOWNCODE'])!;
  const polys = output[i]!;
  return {
    type: 'Feature' as const,
    properties: { code: d.code, name: d.name, city: d.city },
    geometry: polys.length === 1 ? { type: 'Polygon' as const, coordinates: polys[0] } : { type: 'MultiPolygon' as const, coordinates: polys },
  };
});
features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));

const geojson = {
  type: 'FeatureCollection',
  // Foreign member with provenance; ignored by GeoJSON readers.
  butterflycity: {
    source: `MOI district boundaries ${path.basename(base)} (data.gov.tw 7441, OGDL v1)`,
    winding: 'exterior rings clockwise (d3-geo convention)',
    toleranceMeters,
    decimals,
  },
  features,
};

fs.mkdirSync(PUBLIC_DATA, { recursive: true });
const outFile = path.join(PUBLIC_DATA, 'boundaries.geojson');
const text = JSON.stringify(geojson);
fs.writeFileSync(outFile, text);

const worstArea = records
  .map((r, i) => ({ name: DISTRICTS.find((d) => d.code === r.attributes['TOWNCODE'])!.name, change: area(output[i]!) / area(input[i]!) - 1 }))
  .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  .slice(0, 3);
console.log(`tolerance ${toleranceMeters} m, ${decimals} decimals`);
console.log(`points: ${pointCount(input)} -> ${pointCount(output)}`);
console.log(`mismatched border edges: ${mismatchedEdges(input)} before, ${mismatchedEdges(output)} after`);
console.log(`largest area changes: ${worstArea.map((w) => `${w.name} ${(100 * w.change).toFixed(2)}%`).join(', ')}`);
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${(text.length / 1024).toFixed(0)} KB)`);
