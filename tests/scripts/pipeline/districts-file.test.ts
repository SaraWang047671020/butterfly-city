/** Tests for scripts/pipeline/districts-file.ts on small synthetic shapes. Validates Requirements 3.1, 3.2, 3.3, 3.6, 3.7, 3.8. */
import { describe, expect, it } from 'vitest';
import type { Ring } from '../../../scripts/geo/shapefile.ts';
import { signedArea } from '../../../scripts/geo/shapefile.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import {
  buildDistrictsFile,
  checkDistrictCodes,
  districtsStep,
  readAllShapes,
  type ShapeInput,
  type Simplifier,
} from '../../../scripts/pipeline/districts-file.ts';
import { DataError, MissingInputsError } from '../../../scripts/pipeline/errors.ts';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createState } from '../../../scripts/pipeline/run.ts';

const r5 = (x: number) => Number(x.toFixed(5));

/** Clockwise square of 0.01 degrees; district i sits at the i-th slot of a row, so neighbours share an edge. */
function square(i: number, clockwise = true): Ring {
  const x0 = r5(121 + i * 0.01);
  const x1 = r5(121 + (i + 1) * 0.01);
  const cw: Ring = [
    [x0, 25],
    [x0, 25.01],
    [x1, 25.01],
    [x1, 25],
    [x0, 25],
  ];
  return clockwise ? cw : [...cw].reverse();
}

function fixture(): ShapeInput[] {
  return DISTRICTS.map((d, i) => ({ attributes: { TOWNCODE: d.code }, polygons: [[square(i)]] }));
}

const codeOf = (r: ShapeInput) => r.attributes['TOWNCODE']!;

describe('checkDistrictCodes', () => {
  it('accepts exactly the 41 codes and ignores other counties', () => {
    const other: ShapeInput = { attributes: { TOWNCODE: '10001010' }, polygons: [[square(60)]] };
    expect(checkDistrictCodes([other, ...fixture()])).toHaveLength(41);
  });

  it('reports a missing code', () => {
    const records = fixture().slice(1);
    expect(() => checkDistrictCodes(records)).toThrow(DataError);
    try {
      checkDistrictCodes(records);
    } catch (e) {
      expect((e as DataError).details.join('\n')).toContain(`missing: ${DISTRICTS[0]!.code}`);
    }
  });

  it('reports a duplicate code', () => {
    const records = [...fixture(), fixture()[3]!];
    try {
      checkDistrictCodes(records);
      expect.unreachable();
    } catch (e) {
      expect((e as DataError).details.join('\n')).toContain(`duplicate: ${DISTRICTS[3]!.code}`);
    }
  });

  it.each(['63000999', '65999999'])('reports an unexpected code %s', (code) => {
    const records = [...fixture(), { attributes: { TOWNCODE: code }, polygons: [[square(70)]] }];
    try {
      checkDistrictCodes(records);
      expect.unreachable();
    } catch (e) {
      expect((e as DataError).details.join('\n')).toContain(`unexpected code: ${code}`);
    }
  });
});

describe('buildDistrictsFile', () => {
  it('lists 41 districts sorted by code regardless of input order', () => {
    const file = buildDistrictsFile([...fixture()].reverse());
    const codes = file.districts.map((d) => d.code);
    expect(codes).toHaveLength(41);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toEqual(DISTRICTS.map((d) => d.code).sort());
  });

  it('takes city and name from the district table and sets schemaVersion', () => {
    const file = buildDistrictsFile(fixture());
    expect(file.schemaVersion).toBe(1);
    for (const d of file.districts) {
      const ref = DISTRICTS.find((x) => x.code === d.code)!;
      expect(d.city).toBe(ref.city);
      expect(d.name).toBe(ref.name);
    }
  });

  it('rounds area to 2 decimals and centroid to 5, with the centroid inside the bounding box', () => {
    const file = buildDistrictsFile(fixture());
    for (const d of file.districts) {
      expect(d.areaKm2).toBeGreaterThan(0);
      expect(Number(d.areaKm2.toFixed(2))).toBe(d.areaKm2);
      for (const c of d.centroid) expect(Number(c.toFixed(5))).toBe(c);
    }
    const first = file.districts.find((d) => d.code === DISTRICTS[0]!.code)!;
    expect(first.centroid[0]).toBeCloseTo(121.005, 5);
    expect(first.centroid[1]).toBeCloseTo(25.005, 5);
    // 0.01 deg x 0.01 deg at latitude 25: about 1.0 km x 1.1 km
    expect(first.areaKm2).toBeGreaterThan(0.9);
    expect(first.areaKm2).toBeLessThan(1.3);
  });

  it('computes area and centroid from the unsimplified rings', () => {
    // A simplifier that shifts every feature by 1 degree keeps the topology but changes the geometry;
    // area and centroid must still come from the input.
    const shift: Simplifier = (features) =>
      features.map((polys) => polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + 1, y] as const))));
    const file = buildDistrictsFile(fixture(), { simplify: shift });
    const base = buildDistrictsFile(fixture());
    expect(file.districts.map((d) => [d.areaKm2, d.centroid])).toEqual(base.districts.map((d) => [d.areaKm2, d.centroid]));
  });

  it('writes exterior rings clockwise and holes counterclockwise, whatever the input winding', () => {
    const records = fixture();
    const hole: Ring = [
      [121.003, 25.003],
      [121.007, 25.003],
      [121.007, 25.007],
      [121.003, 25.007],
      [121.003, 25.003],
    ]; // counterclockwise
    records[0] = { attributes: records[0]!.attributes, polygons: [[square(0, false), [...hole].reverse()]] };
    const file = buildDistrictsFile(records);
    const geometry = file.districts.find((d) => d.code === codeOf(records[0]!))!.geometry;
    expect(geometry.type).toBe('Polygon');
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : [];
    expect(rings).toHaveLength(2);
    expect(signedArea(rings[0]!)).toBeLessThan(0);
    expect(signedArea(rings[1]!)).toBeGreaterThan(0);
    for (const d of file.districts) {
      const polys = d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates;
      for (const poly of polys) {
        poly.forEach((ring, i) => {
          expect(signedArea(ring) < 0).toBe(i === 0);
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
        });
      }
    }
  });

  it('uses MultiPolygon for a district with several polygons', () => {
    const records = fixture();
    const far: Ring = [
      [122, 24],
      [122, 24.01],
      [122.01, 24.01],
      [122.01, 24],
      [122, 24],
    ];
    records[5] = { attributes: records[5]!.attributes, polygons: [[square(5)], [far]] };
    const file = buildDistrictsFile(records);
    expect(file.districts.find((d) => d.code === codeOf(records[5]!))!.geometry.type).toBe('MultiPolygon');
  });

  it('embeds provenance for every field plus the sources and methods it references', () => {
    const file = buildDistrictsFile(fixture());
    expect(Object.keys(file.provenance)).toEqual(['code', 'city', 'name', 'areaKm2', 'centroid', 'geometry']);
    expect(file.provenance.areaKm2.method).toBe('district-area');
    expect(file.provenance.centroid.method).toBe('district-centroid');
    expect(file.provenance.geometry.method).toBe('boundary-simplify');
    const sourceIds = file.sources.map((s) => s.id);
    for (const p of Object.values(file.provenance)) for (const s of p.sources) expect(sourceIds).toContain(s);
    expect(file.methods.map((m) => m.id).sort()).toEqual(['boundary-simplify', 'district-area', 'district-centroid']);
  });

  it('stops when simplification raises the mismatched-edge count', () => {
    // Adds a midpoint on every edge of the first feature only, so its shared edges no longer match its neighbour's.
    const breaking: Simplifier = (features) =>
      features.map((polys, f) =>
        f !== 0
          ? polys
          : polys.map((poly) =>
              poly.map((ring) =>
                ring.flatMap((p, i) => {
                  const next = ring[i + 1];
                  return next === undefined ? [p] : [p, [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2] as const];
                }),
              ),
            ),
      );
    expect(() => buildDistrictsFile(fixture(), { simplify: breaking })).toThrow(/mismatched-edges/);
  });

  it('rejects a record with no geometry', () => {
    const records = fixture();
    records[2] = { attributes: records[2]!.attributes, polygons: [] };
    expect(() => buildDistrictsFile(records)).toThrow(DataError);
  });
});

describe('readAllShapes and districtsStep', () => {
  it('report a missing shapefile as a missing input with a download id', () => {
    const ctx = createContext({ reader: new MemoryRawReader({}), logger: memoryLogger() });
    expect(() => readAllShapes(ctx)).toThrow(MissingInputsError);
    expect(() => districtsStep().run(ctx, createState())).toThrow(MissingInputsError);
  });

  it('has the step name "districts"', () => {
    expect(districtsStep().name).toBe('districts');
  });
});
