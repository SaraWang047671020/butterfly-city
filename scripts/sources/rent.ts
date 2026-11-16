/**
 * Rent context beyond real-price registration (all official):
 *   - MOI district rent statistics (全國行政區租金統計), ODS files linked from
 *     https://pip.moi.gov.tw/Publicize/Info/E1080 (no license stated on the page)
 *   - Taipei housing rent index, quarterly from 2018Q3 (data.gov.tw 171234, OGDL v1)
 *   - 2020 Population and Housing Census, table 34 "home ownership of ordinary households" per
 *     district, for Taipei and New Taipei (DGBAS, data.gov.tw 10906, OGDL v1). Gives the number of
 *     renting households per district.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseNumber } from '../lib/csv.ts';
import { datasetMeta } from '../lib/datagov.ts';
import { DISTRICTS, districtByZh, missingDistricts } from '../lib/districts.ts';
import { downloadFile, getText, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { readOdsRows } from '../lib/zip.ts';
import { logResult, type Source } from './types.ts';

const CENSUS = [
  { city: '新北市', file: 'census2020-ntpc-s034-tenure.ods', url: 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230886/s034.ods' },
  { city: '臺北市', file: 'census2020-taipei-s034-tenure.ods', url: 'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11065/230887/s034.ods' },
] as const;

export interface TenureRow {
  readonly code: string;
  readonly households: number;
  readonly renting: number;
}

/** Reads census table 34: district rows have [name, total, owned, owned by family, renting, other, English name]. */
export function readTenure(cityZh: string, buf: Buffer): TenureRow[] {
  const out: TenureRow[] = [];
  for (const row of readOdsRows(buf)) {
    if (row.length < 6 || !/區$/.test(row[0] ?? '')) continue;
    const d = districtByZh(cityZh + (row[0] ?? ''));
    if (d) out.push({ code: d.code, households: parseNumber(row[1] ?? ''), renting: parseNumber(row[4] ?? '') });
  }
  return out;
}

/** District codes present in an MOI district rent statistics ODS file (rows: id, city, district, ...). */
export function districtsInRentStats(buf: Buffer): Set<string> {
  const found = new Set<string>();
  for (const row of readOdsRows(buf)) {
    for (let i = 0; i < row.length - 1; i++) {
      const d = districtByZh((row[i] ?? '') + (row[i + 1] ?? ''));
      if (d) found.add(d.code);
    }
  }
  return found;
}

export const rent: Source = {
  id: 'rent',
  title: 'Rent context: MOI district rent statistics, Taipei rent index, 2020 census renter households',
  async download({ force }) {
    const page = await getText('https://pip.moi.gov.tw/Publicize/Info/E1080');
    const decoded = page.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
    const ods = [...new Set([...decoded.matchAll(/href="([^"]+\.ods)\s*"/g)].map((m) => m[1] ?? ''))];
    for (const href of ods) {
      const url = new URL(encodeURI(href), 'https://pip.moi.gov.tw').toString();
      logResult(path.basename(href), await downloadFile(url, raw('rent-stats', path.basename(href)), { force, validate: notHtml }));
    }
    const taipei = (await datasetMeta(171234)).distribution[0];
    if (taipei) logResult('Taipei rent index', await downloadFile(taipei.resourceDownloadUrl, raw('rent-stats', 'taipei-171234-rent-index.csv'), { force, validate: notHtml }));
    for (const c of CENSUS) logResult(c.file, await downloadFile(c.url, raw('census', c.file), { force, validate: notHtml }));
  },
  async check() {
    const statsDir = raw('rent-stats');
    if (fs.existsSync(statsDir)) {
      for (const f of fs.readdirSync(statsDir).filter((n) => n.endsWith('.ods'))) {
        const missing = missingDistricts(districtsInRentStats(fs.readFileSync(path.join(statsDir, f))));
        console.log(`${f}: ${41 - missing.length}/41 districts; missing ${missing.map((d) => d.name).join(', ') || 'none'}`);
      }
    }
    const rows: TenureRow[] = [];
    for (const c of CENSUS) {
      const file = raw('census', c.file);
      if (fs.existsSync(file)) rows.push(...readTenure(c.city, fs.readFileSync(file)));
    }
    console.log(`2020 census renting households: ${rows.length}/41 districts`);
    console.log('district | households | renting | share');
    for (const d of DISTRICTS) {
      const r = rows.find((x) => x.code === d.code);
      if (r) console.log(`${d.name} | ${r.households} | ${r.renting} | ${((100 * r.renting) / r.households).toFixed(1)}%`);
    }
  },
};
