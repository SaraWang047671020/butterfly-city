/**
 * Observed commuting, 2020 Population and Housing Census (DGBAS, data.gov.tw 10906, OGDL v1).
 * Table 14 of each city report: employed residents aged 15+ by district of residence, split into
 * working in the same district, in another district of the same city, and in another county or
 * abroad. There is no district-to-district matrix in the published tables.
 * Network travel times for the commute matrix come from the `stations` source.
 */
import fs from 'node:fs';
import { parseNumber } from '../lib/csv.ts';
import { DISTRICTS, districtByZh } from '../lib/districts.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { readOdsRows } from '../lib/zip.ts';
import { logResult, type Source } from './types.ts';

const FILES = [
  { city: '新北市', file: 'census2020-ntpc-s014-workplace.ods', url: 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230886/s014.ods' },
  { city: '臺北市', file: 'census2020-taipei-s014-workplace.ods', url: 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230887/s014.ods' },
] as const;

export interface WorkplaceRow {
  readonly code: string;
  readonly workers: number;
  readonly sameDistrict: number;
  readonly otherDistrictSameCity: number;
  readonly otherCountyOrAbroad: number;
}

/**
 * Reads the first block of table 14 ("(1) 總計"), whose district rows are
 * [name, total, same district, other district in same city, other county or abroad].
 * Later blocks repeat the districts by sex, so only the first occurrence of each district is kept.
 */
export function readWorkplace(cityZh: string, buf: Buffer): WorkplaceRow[] {
  const out: WorkplaceRow[] = [];
  for (const row of readOdsRows(buf)) {
    if (row.length < 5 || !/區$/.test(row[0] ?? '')) continue;
    const d = districtByZh(cityZh + (row[0] ?? ''));
    if (!d || out.some((o) => o.code === d.code)) continue;
    const [total, same, otherDistrict, otherCounty] = row.slice(1, 5).map((v) => parseNumber(v ?? ''));
    out.push({ code: d.code, workers: total!, sameDistrict: same!, otherDistrictSameCity: otherDistrict!, otherCountyOrAbroad: otherCounty! });
  }
  return out;
}

export const commute: Source = {
  id: 'commute',
  title: '2020 census: where employed residents of each district work (same district / city / other)',
  async download({ force }) {
    for (const f of FILES) logResult(f.file, await downloadFile(f.url, raw('census', f.file), { force, validate: notHtml }));
  },
  async check() {
    const rows: WorkplaceRow[] = [];
    for (const f of FILES) {
      const file = raw('census', f.file);
      if (fs.existsSync(file)) rows.push(...readWorkplace(f.city, fs.readFileSync(file)));
    }
    console.log(`2020 census workplace table: ${rows.length}/41 districts`);
    console.log('district | employed residents | same district | other district, same city | other county or abroad');
    const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
    for (const d of DISTRICTS) {
      const r = rows.find((x) => x.code === d.code);
      if (r) console.log(`${d.name} | ${r.workers} | ${pct(r.sameDistrict, r.workers)} | ${pct(r.otherDistrictSameCity, r.workers)} | ${pct(r.otherCountyOrAbroad, r.workers)}`);
    }
  },
};
