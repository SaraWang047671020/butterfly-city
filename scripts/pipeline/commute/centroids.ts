/**
 * Population-weighted district centroids (Requirement 24 criteria 12 to 16).
 *
 *   village population = sum of the six fields household_{ordinary,business,single}_{m,f} of ODRP019 (ROC 114)
 *   district centroid  = mean of the village polygon centroids, weighted by village population
 *
 * ODRP019 and the village boundary file (data.gov.tw 130549, ROC 114 edition) are joined by the 11-digit village code only; the
 * first 8 digits are the District_Code. ODRP019 has no district total row, so the district total of the check
 * is the sum of people_total of ODRP014 for 2025-12 (ROC 11412), the file the population indicator reads for
 * 2025Q4.
 *
 * The builders are pure. `loadVillageCentroids` reads the raw files through a RawReader.
 */
import { readShapefile, type Polygon, type Position } from '../../geo/shapefile.ts';
import { readZip } from '../../lib/zip.ts';
import { DataError } from '../errors.ts';
import { centroid, haversineKm, type DistrictShape } from '../geo.ts';
import { codePointCompare } from '../numeric.ts';
import { parsePopulationJson } from '../parsers/household.ts';
import type { RawReader } from '../raw-reader.ts';

export const ODRP019_PAGE_FILES: readonly string[] = [1, 2, 3, 4].map((n) => `villages/moi-odrp019-114-page${n}.json`);
export const VILLAGE_ZIP = 'villages/village-boundaries-114.zip';
/** The ODRP014 months of the population indicator for 2025Q4, used as the district total. */
export const DISTRICT_TOTAL_MONTH = '11412';

const POPULATION_FIELDS = [
  'household_ordinary_m',
  'household_business_m',
  'household_single_m',
  'household_ordinary_f',
  'household_business_f',
  'household_single_f',
] as const;

const VILLAGE_CODE = /^\d{11}$/;
const CHANGE_NOTE = 'possible cause: administrative changes of 2025-12 (village merges, splits or renamed codes) between the two files';

export interface VillagePopulation {
  readonly code: string;
  readonly village: string;
  readonly population: number;
}

export interface VillageShape {
  readonly code: string;
  readonly name: string;
  readonly polygons: readonly Polygon[];
}

export interface DistrictCentroid {
  readonly code: string;
  readonly villageCount: number;
  readonly population: number;
  /** Population-weighted mean of the village polygon centroids, [lon, lat]. */
  readonly weighted: Position;
  /** Area-weighted centroid of the district polygon, [lon, lat]. */
  readonly geometric: Position;
  readonly offsetKm: number;
}

export interface CentroidResult {
  /** Keyed by District_Code, in ascending code order. */
  readonly districts: ReadonlyMap<string, DistrictCentroid>;
  /** The 5 districts with the largest weighted-to-geometric distance, largest first. */
  readonly largestOffsets: readonly DistrictCentroid[];
  /** Codes of boundary records with an empty village name and R or P in the code (unassigned areas), skipped. */
  readonly unassigned: readonly string[];
}

/** An unassigned area: empty village name and a code containing R or P (e.g. ...R01, ...P01). */
export function isUnassignedArea(shape: Pick<VillageShape, 'code' | 'name'>): boolean {
  return shape.name.trim() === '' && /[RP]/.test(shape.code);
}

/** District_Code of a village code: its first 8 digits. */
export function districtOfVillage(villageCode: string): string {
  return villageCode.slice(0, 8);
}

/** Parses the ODRP019 page files (JSON text) into village rows of every county. */
export function parseOdrp019(texts: readonly { readonly text: string; readonly shown: string }[]): VillagePopulation[] {
  const out: VillagePopulation[] = [];
  const seen = new Set<string>();
  for (const { text, shown } of texts) {
    const body = JSON.parse(text) as { responseData?: readonly Record<string, string>[] };
    const rows = body.responseData;
    if (rows === undefined) throw new DataError('odrp019-format', shown, ['no responseData']);
    rows.forEach((r, i) => {
      const where = `${shown} row ${i + 1}`;
      const code = r['district_code'] ?? '';
      if (!VILLAGE_CODE.test(code)) throw new DataError('odrp019-village-code', where, [`district_code "${code}" is not 11 digits`]);
      if (seen.has(code)) throw new DataError('odrp019-duplicate-village', where, [`village code ${code} appears twice`]);
      seen.add(code);
      let population = 0;
      for (const f of POPULATION_FIELDS) {
        const raw = r[f] ?? '';
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) throw new DataError('odrp019-count', where, [`${f} = "${raw}" is not a non-negative integer`]);
        population += n;
      }
      out.push({ code, village: r['village'] ?? '', population });
    });
  }
  return out;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Reads the village polygons (VILLAGE_NLSC_*) from the outer zip bytes. The outer zip holds an inner zip whose
 * folder (村里界歷史圖資_114) holds the layer; the layer is matched by the VILLAGE_NLSC_ prefix. Records keep the
 * file order.
 */
export function parseVillageZip(zip: Buffer): VillageShape[] {
  const inner = readZip(zip).find((e) => /\.zip$/i.test(e.name));
  if (inner === undefined) throw new DataError('village-zip', VILLAGE_ZIP, ['no inner zip in the outer zip']);
  const entries = readZip(inner.read());
  const find = (ext: RegExp) => entries.find((e) => /^VILLAGE_NLSC_\d+\.[A-Za-z]+$/i.test(baseName(e.name)) && ext.test(e.name));
  const shp = find(/\.shp$/i);
  const dbf = find(/\.dbf$/i);
  if (shp === undefined || dbf === undefined) throw new DataError('village-zip', VILLAGE_ZIP, ['no VILLAGE_NLSC_*.shp and .dbf in the zip']);
  const cpg = find(/\.cpg$/i)?.read().toString('utf8').trim() ?? 'UTF-8';
  const encoding = /utf-?8/i.test(cpg) ? 'utf-8' : 'big5';
  return readShapefile(shp.read(), dbf.read(), encoding).map((r) => {
    const code = r.attributes['VILLCODE'] ?? '';
    // Some villages outside the two cities have a letter in the code (e.g. 09007010S31); only length is checked.
    if (code.length !== 11) throw new DataError('village-boundary-code', VILLAGE_ZIP, [`VILLCODE "${code}" is not 11 characters`]);
    return { code, name: r.attributes['VILLNAME'] ?? '', polygons: r.polygons };
  });
}

/**
 * Builds the centroids of the given districts. `districtTotals` maps District_Code to the registered population
 * the village sums must equal. Throws DataError for: a village code of one file missing from the other (within the
 * districts), a district without a village, a village without polygon, a district without a geometric centroid,
 * and a district whose village sum differs from its total.
 */
export function buildCentroids(
  populations: readonly VillagePopulation[],
  shapes: readonly VillageShape[],
  districtShapes: readonly DistrictShape[],
  districtTotals: ReadonlyMap<string, number>,
): CentroidResult {
  const wanted = new Set(districtShapes.map((d) => d.code));
  const pops = new Map<string, VillagePopulation>();
  for (const p of populations) if (wanted.has(districtOfVillage(p.code))) pops.set(p.code, p);
  const polys = new Map<string, VillageShape>();
  const unassigned: string[] = [];
  for (const s of shapes) {
    if (!wanted.has(districtOfVillage(s.code))) continue;
    if (isUnassignedArea(s)) {
      unassigned.push(s.code);
      continue;
    }
    if (polys.has(s.code)) throw new DataError('village-boundary-duplicate', s.code, ['village code appears twice in the boundary file']);
    polys.set(s.code, s);
  }
  const onlyPopulation = [...pops.keys()].filter((c) => !polys.has(c)).sort(codePointCompare);
  const onlyBoundary = [...polys.keys()].filter((c) => !pops.has(c)).sort(codePointCompare);
  if (onlyPopulation.length > 0 || onlyBoundary.length > 0) {
    throw new DataError('unmatched-village-code', `${onlyPopulation.length + onlyBoundary.length} village codes`, [
      CHANGE_NOTE,
      ...onlyPopulation.map((c) => `${c} ${pops.get(c)!.village}: in ODRP019, not in the village boundary file`),
      ...onlyBoundary.map((c) => `${c}: in the village boundary file, not in ODRP019`),
    ]);
  }

  const byDistrict = new Map<string, string[]>();
  for (const code of [...pops.keys()].sort(codePointCompare)) {
    const d = districtOfVillage(code);
    byDistrict.set(d, [...(byDistrict.get(d) ?? []), code]);
  }
  const districts = new Map<string, DistrictCentroid>();
  for (const ds of [...districtShapes].sort((a, b) => codePointCompare(a.code, b.code))) {
    const codes = byDistrict.get(ds.code);
    if (codes === undefined || codes.length === 0) throw new DataError('district-without-village', ds.code, ['the district has no village']);
    let population = 0;
    let lon = 0;
    let lat = 0;
    for (const c of codes) {
      const w = pops.get(c)!.population;
      const [x, y] = centroid(polys.get(c)!.polygons);
      population += w;
      lon += x * w;
      lat += y * w;
    }
    const total = districtTotals.get(ds.code);
    if (total !== population) {
      throw new DataError('district-population-mismatch', ds.code, [`village sum ${population}`, `district total ${total === undefined ? 'missing' : total}`]);
    }
    if (population === 0) throw new DataError('district-without-population', ds.code, ['the village population sum is 0']);
    const weighted: Position = [lon / population, lat / population];
    const geometric = centroid(ds.polygons);
    districts.set(ds.code, { code: ds.code, villageCount: codes.length, population, weighted, geometric, offsetKm: haversineKm(weighted, geometric) });
  }
  const largestOffsets = [...districts.values()].sort((a, b) => b.offsetKm - a.offsetKm || codePointCompare(a.code, b.code)).slice(0, 5);
  return { districts, largestOffsets, unassigned: unassigned.sort(codePointCompare) };
}

/** Reads the raw files and builds the centroids; the district total is ODRP014 for ROC 11412. */
export function loadVillageCentroids(reader: RawReader, districtShapes: readonly DistrictShape[]): CentroidResult {
  const populations = parseOdrp019(ODRP019_PAGE_FILES.map((p) => ({ text: reader.readText(p), shown: reader.display(p) })));
  const shapes = parseVillageZip(reader.readBytes(VILLAGE_ZIP));
  const totals = new Map<string, number>();
  for (const county of ['臺北市', '新北市']) {
    const p = `population/ris/ODRP014-${DISTRICT_TOTAL_MONTH}-${county}.json`;
    for (const r of parsePopulationJson(reader.readText(p), reader.display(p))) {
      totals.set(r.districtCode, (totals.get(r.districtCode) ?? 0) + r.peopleTotal);
    }
  }
  return buildCentroids(populations, shapes, districtShapes, totals);
}

/** The line printed for criterion 16, one per district. */
export function formatLargestOffsets(result: CentroidResult): string[] {
  return result.largestOffsets.map((d) => `${d.code} ${d.offsetKm.toFixed(2)} km`);
}
