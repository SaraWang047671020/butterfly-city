/**
 * District boundaries, MOI Department of Land Administration via TGOS (data.gov.tw 7441, OGDL v1).
 * Shapefile, TWD97 geographic coordinates, attributes TOWNCODE / COUNTYNAME / TOWNNAME / TOWNENG.
 */
import fs from 'node:fs';
import path from 'node:path';
import { datasetMeta } from '../lib/datagov.ts';
import { DISTRICTS, missingDistricts } from '../lib/districts.ts';
import { downloadFile } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { readZip } from '../lib/zip.ts';
import { readShapefile, type ShapeRecord } from '../geo/shapefile.ts';
import { logResult, type Source } from './types.ts';

const dir = raw('boundaries');

/** Finds the extracted TOWN_MOI_* shapefile with the latest edition date. */
export function latestShapefileBase(): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const bases = fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /TOWN_MOI_\d+\.shp$/i.test(f))
    .map((f) => path.join(dir, f.replace(/\.shp$/i, '')))
    .sort();
  return bases[bases.length - 1];
}

/** Reads the 41 target districts from the extracted shapefile. */
export function readDistrictShapes(): { base: string; records: ShapeRecord[] } {
  const base = latestShapefileBase();
  if (!base) throw new Error('No TOWN_MOI_*.shp in data/raw/boundaries. Run: node scripts/download.ts boundaries');
  const cpg = fs.existsSync(`${base}.CPG`) ? fs.readFileSync(`${base}.CPG`, 'utf8').trim() : 'UTF-8';
  const encoding = /utf-?8/i.test(cpg) ? 'utf-8' : 'big5';
  const all = readShapefile(fs.readFileSync(`${base}.shp`), fs.readFileSync(`${base}.dbf`), encoding);
  const codes = new Set(DISTRICTS.map((d) => d.code));
  return { base, records: all.filter((r) => codes.has(r.attributes['TOWNCODE'] ?? '')) };
}

export const boundaries: Source = {
  id: 'boundaries',
  title: 'MOI district boundary shapefile (TGOS), extracted to data/raw/boundaries/',
  async download({ force }) {
    const meta = await datasetMeta(7441, true);
    const resource = meta.distribution.find((r) => r.resourceFormat === 'SHP');
    if (!resource) throw new Error('data.gov.tw 7441 has no SHP resource');
    const edition = resource.resourceDownloadUrl.match(/(\d{7})\.zip$/)?.[1] ?? 'latest';
    const zipFile = path.join(dir, `town-boundaries-${edition}.zip`);
    const encoded = resource.resourceDownloadUrl.replace(/[^/]+$/, (name) => encodeURIComponent(name));
    logResult(`edition ${edition}`, await downloadFile(encoded, zipFile, { force, minBytes: 1_000_000 }));
    const outDir = path.join(dir, `town-${edition}`);
    for (const entry of readZip(fs.readFileSync(zipFile))) {
      if (!/^TOWN_MOI_\d+\.(shp|shx|dbf|prj|cpg)$/i.test(path.basename(entry.name))) continue;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, path.basename(entry.name)), entry.read());
      console.log(`  extracted ${path.basename(entry.name)} (${entry.size} bytes)`);
    }
  },
  async check() {
    const { base, records } = readDistrictShapes();
    const points = records.reduce((s, r) => s + r.polygons.flat(2).length, 0);
    const missing = missingDistricts(records.map((r) => r.attributes['TOWNCODE'] ?? ''));
    console.log(`${path.basename(base)}: ${records.length}/41 districts, ${points} points, missing: ${missing.map((d) => d.name).join(', ') || 'none'}`);
    for (const r of records) {
      const d = DISTRICTS.find((x) => x.code === r.attributes['TOWNCODE']);
      const eng = (r.attributes['TOWNENG'] ?? '').replace(/ District$/, '');
      if (d && d.name !== eng) console.log(`  name differs for ${d.code}: ours "${d.name}", source "${eng}"`);
    }
  },
};
