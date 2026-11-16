/**
 * Builds the DistrictsFile (public/data/districts.json content) from shapefile records.
 *
 * `buildDistrictsFile` is pure: it takes parsed shape records and returns the in-memory object with
 * final rounded values. `districtsStep` reads the real shapefile through the RawReader.
 *
 * Rules (Requirement 3):
 * - every TOWNCODE starting with 63 or 65 must be one of the 41 district codes, each exactly once;
 * - geometry is simplified with shared borders kept identical (40 m, 5 decimals); the mismatched-edge
 *   count after simplification must not exceed the count before;
 * - area (2 decimals) and centroid (5 decimals) come from the unsimplified rings;
 * - exterior rings are clockwise and holes counterclockwise (d3-geo convention);
 * - entries are sorted by code.
 */
import type {
  CityName,
  DistrictEntry,
  DistrictsFile,
  FieldProvenance,
  Geometry,
  Ring as OutRing,
} from '../../src/types/data-files.ts';
import { SCHEMA_VERSION } from '../../src/types/data-files.ts';
import { readShapefile, signedArea, type Polygon, type Ring } from '../geo/shapefile.ts';
import { simplifyTopology, type SimplifyOptions } from '../geo/simplify.ts';
import { DISTRICTS } from '../lib/districts.ts';
import type { BuildContext } from './context.ts';
import { DataError, MissingInputsError } from './errors.ts';
import { centroid, mismatchedEdges, polygonsAreaKm2 } from './geo.ts';
import { codePointCompare, roundTo } from './numeric.ts';
import { referencedMethods } from './registry/methods.ts';
import { referencedSources } from './registry/sources.ts';
import type { BuildState, Step } from './run.ts';

export const SIMPLIFY_TOLERANCE_METERS = 40;
export const COORDINATE_DECIMALS = 5;
export const AREA_DECIMALS = 2;
export const CENTROID_DECIMALS = 5;
export const BOUNDARY_SOURCE_ID = 'boundaries/moi-7441';

/** The part of a shapefile record the builder needs. */
export interface ShapeInput {
  readonly attributes: Readonly<Record<string, string>>;
  readonly polygons: readonly Polygon[];
}

export type Simplifier = (features: readonly (readonly Polygon[])[], options: SimplifyOptions) => readonly (readonly Polygon[])[];

export interface BuildDistrictsOptions {
  /** Replaces the shared-border simplifier; used by tests. */
  readonly simplify?: Simplifier;
}

/** Taipei and New Taipei codes start with 63 or 65. */
const isTargetCode = (code: string): boolean => code.startsWith('63') || code.startsWith('65');

/**
 * Checks the unfiltered records: each of the 41 codes exactly once, no other 63* or 65* code.
 * Returns the matching records in ascending code order. Throws one DataError listing every problem.
 */
export function checkDistrictCodes(records: readonly ShapeInput[]): ShapeInput[] {
  const known = new Set(DISTRICTS.map((d) => d.code));
  const found = new Map<string, ShapeInput[]>();
  const unexpected = new Set<string>();
  for (const record of records) {
    const code = record.attributes['TOWNCODE'] ?? '';
    if (known.has(code)) found.set(code, [...(found.get(code) ?? []), record]);
    else if (isTargetCode(code)) unexpected.add(code);
  }
  const problems: string[] = [];
  for (const d of DISTRICTS) {
    const n = found.get(d.code)?.length ?? 0;
    if (n === 0) problems.push(`missing: ${d.code} ${d.name}`);
    else if (n > 1) problems.push(`duplicate: ${d.code} ${d.name} appears ${n} times`);
  }
  for (const code of [...unexpected].sort(codePointCompare)) problems.push(`unexpected code: ${code}`);
  if (problems.length > 0) throw new DataError('district-codes', 'boundary shapefile', problems);
  return [...known]
    .sort(codePointCompare)
    .map((code) => found.get(code)![0]!);
}

/** Rewinds rings: exterior clockwise (negative signed area), holes counterclockwise. */
function windRing(ring: Ring, clockwise: boolean): Ring {
  const isClockwise = signedArea(ring) < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function roundRing(ring: Ring): OutRing {
  return ring.map(([x, y]) => [roundTo(x, COORDINATE_DECIMALS), roundTo(y, COORDINATE_DECIMALS)] as const);
}

function toGeometry(polygons: readonly Polygon[]): Geometry {
  const wound = polygons.map((p) => p.map((ring, i) => roundRing(windRing(ring, i === 0))));
  if (wound.length === 1) return { type: 'Polygon', coordinates: wound[0]! };
  return { type: 'MultiPolygon', coordinates: wound };
}

const provenance = (method?: string): FieldProvenance =>
  method === undefined ? { sources: [BOUNDARY_SOURCE_ID] } : { sources: [BOUNDARY_SOURCE_ID], method };

/** Builds the districts file from unfiltered shapefile records. */
export function buildDistrictsFile(records: readonly ShapeInput[], options: BuildDistrictsOptions = {}): DistrictsFile {
  const simplify: Simplifier = options.simplify ?? simplifyTopology;
  const ordered = checkDistrictCodes(records);
  const input = ordered.map((r) => r.polygons);
  for (const [i, polys] of input.entries()) {
    if (polys.length === 0) throw new DataError('empty-geometry', ordered[i]!.attributes['TOWNCODE'] ?? '');
  }

  const output = simplify(input, { toleranceMeters: SIMPLIFY_TOLERANCE_METERS, decimals: COORDINATE_DECIMALS });
  if (output.length !== input.length) {
    throw new DataError('simplify', `returned ${output.length} features for ${input.length}`);
  }
  const before = mismatchedEdges(input);
  const after = mismatchedEdges(output);
  if (after > before) {
    throw new DataError('mismatched-edges', 'boundary simplification', [
      `mismatched border edges rose from ${before} to ${after}`,
    ]);
  }

  const districts: DistrictEntry[] = ordered.map((record, i) => {
    const code = record.attributes['TOWNCODE']!;
    const ref = DISTRICTS.find((d) => d.code === code)!;
    const [lon, lat] = centroid(record.polygons);
    return {
      code,
      city: ref.city as CityName,
      name: ref.name,
      areaKm2: roundTo(polygonsAreaKm2(record.polygons), AREA_DECIMALS),
      centroid: [roundTo(lon, CENTROID_DECIMALS), roundTo(lat, CENTROID_DECIMALS)],
      geometry: toGeometry(output[i]!),
    };
  });
  districts.sort((a, b) => codePointCompare(a.code, b.code));

  const prov = {
    code: provenance(),
    city: provenance(),
    name: provenance(),
    areaKm2: provenance('district-area'),
    centroid: provenance('district-centroid'),
    geometry: provenance('boundary-simplify'),
  };
  const methodIds = Object.values(prov).flatMap((p) => (p.method === undefined ? [] : [p.method]));
  return {
    schemaVersion: SCHEMA_VERSION,
    provenance: prov,
    districts,
    sources: referencedSources(Object.values(prov).flatMap((p) => p.sources)),
    methods: referencedMethods(methodIds),
  };
}

/** Finds the latest TOWN_MOI_*.shp under boundaries/ (one directory level) and returns the unfiltered records. */
export function readAllShapes(ctx: BuildContext): ShapeInput[] {
  const { reader } = ctx;
  const bases: string[] = [];
  for (const dir of ['boundaries', ...reader.list('boundaries').map((n) => `boundaries/${n}`)]) {
    for (const name of reader.list(dir)) {
      if (/^TOWN_MOI_\d+\.shp$/i.test(name)) bases.push(`${dir}/${name.replace(/\.shp$/i, '')}`);
    }
  }
  bases.sort(codePointCompare);
  const base = bases[bases.length - 1];
  if (base === undefined) {
    throw new MissingInputsError([{ path: reader.display('boundaries/TOWN_MOI_*.shp'), downloadId: 'boundaries' }]);
  }
  const dir = base.slice(0, base.lastIndexOf('/'));
  const stem = base.slice(base.lastIndexOf('/') + 1);
  const files = reader.list(dir);
  const find = (ext: string) => files.find((n) => n.toLowerCase() === `${stem}.${ext}`.toLowerCase());
  const shp = find('shp');
  const dbf = find('dbf');
  if (shp === undefined || dbf === undefined) {
    throw new MissingInputsError([{ path: reader.display(`${base}.dbf`), downloadId: 'boundaries' }]);
  }
  const cpg = find('cpg');
  const cpgText = cpg === undefined ? 'UTF-8' : reader.readText(`${dir}/${cpg}`).trim();
  const encoding = /utf-?8/i.test(cpgText) ? 'utf-8' : 'big5';
  return readShapefile(reader.readBytes(`${dir}/${shp}`), reader.readBytes(`${dir}/${dbf}`), encoding);
}

/** Step factory: reads the real shapefile and stores the DistrictsFile in the build state. */
export function districtsStep(options: BuildDistrictsOptions = {}): Step {
  return {
    name: 'districts',
    run(ctx: BuildContext, state: BuildState) {
      const records = readAllShapes(ctx);
      state.districtsFile = buildDistrictsFile(records, options);
      state.shapes = checkDistrictCodes(records).map((r) => ({ code: r.attributes['TOWNCODE'] as string, polygons: r.polygons }));
    },
  };
}
