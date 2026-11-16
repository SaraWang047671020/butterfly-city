/**
 * Population and in/out migration, MOI Department of Household Registration (OGDL v1).
 *
 * Monthly, village level (summed to districts):
 *   - population 2015-01..2017-12: data.gov.tw 32973 (CSV per month, "ODRP005")
 *   - migration  2015-12..2017-12: data.gov.tw 32975 (CSV per month, "ODRP002")
 *   - 2018-01..2025-12: ris.gov.tw open API, ODRP010 (population, to 2020-08), ODRP060 (population,
 *     from 2020-09), ODRP011 (migration). Months the API does not return are taken from the CSV
 *     resources of data.gov.tw 131138 (population) and 77144 (migration).
 * Annual per district (to cover migration 2015-01..2015-11):
 *   - Taipei DBAS statistics database, funid a05002802
 *   - New Taipei DBAS, data.gov.tw 124872 (unlabeled columns: percent3 = move-in, percent20 = move-out)
 */
import fs from 'node:fs';
import { parseCsv } from '../lib/csv.ts';
import { datasetMeta } from '../lib/datagov.ts';
import { DISTRICTS, districtByZh, missingDistricts } from '../lib/districts.ts';
import { downloadFile, getJson, notHtml, sleep } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { rocMonthsBetween } from '../lib/time.ts';
import { logResult, type Source } from './types.ts';

const COUNTIES = ['臺北市', '新北市'] as const;
const dir = (...p: string[]) => raw('population', 'ris', ...p);

interface RisResponse {
  readonly responseCode?: string;
  readonly responseMessage?: string;
  readonly totalPage?: string;
  readonly responseData?: readonly Record<string, string>[];
}

/** Calls one ris.gov.tw dataset for one month and county, following pagination. Returns null if no data. */
async function risMonth(api: string, yyymm: string, county: string): Promise<Record<string, string>[] | null> {
  const rows: Record<string, string>[] = [];
  for (let page = 1; ; page++) {
    const url = `https://www.ris.gov.tw/rs-opendata/api/v1/datastore/${api}/${yyymm}?COUNTY=${encodeURIComponent(county)}&PAGE=${page}`;
    const res = await getJson<RisResponse>(url);
    if (res.responseCode && res.responseCode !== 'OD-0101-S') return null; // OD-0102-S = no data
    rows.push(...(res.responseData ?? []));
    if (page >= Number(res.totalPage ?? 1)) return rows;
  }
}

/** Finds the CSV resource of a data.gov.tw dataset whose description starts with or contains `yyymm`. */
async function csvResourceFor(datasetId: number, yyymm: string): Promise<string | undefined> {
  const meta = await datasetMeta(datasetId);
  return meta.distribution.find((r) => r.resourceFormat === 'CSV' && r.resourceDescription.includes(yyymm))?.resourceDownloadUrl;
}

const populationApi = (yyymm: string) => (Number(yyymm) >= 10909 ? 'ODRP060' : 'ODRP010');

async function downloadApiMonth(api: string, yyymm: string, force: boolean, fallbackDataset: number): Promise<void> {
  const files = COUNTIES.map((c) => dir(`${api}-${yyymm}-${c}.json`));
  if (!force && files.every((f) => fs.existsSync(f))) return;
  for (const [i, county] of COUNTIES.entries()) {
    const rows = await risMonth(api, yyymm, county);
    if (rows === null) {
      const url = await csvResourceFor(fallbackDataset, yyymm);
      if (!url) {
        console.log(`  ${api} ${yyymm}: not in API and no CSV in data.gov.tw ${fallbackDataset}`);
        return;
      }
      logResult(`${api} ${yyymm} (CSV fallback)`, await downloadFile(url, dir(`${api}-${yyymm}.csv`), { force, validate: notHtml }));
      return;
    }
    fs.writeFileSync(files[i]!, JSON.stringify(rows));
    await sleep(200);
  }
  console.log(`  ${api} ${yyymm}: downloaded from API`);
}

/** Reads every district (by code) present in one month, from API JSON files or a CSV file. */
export function districtsInMonth(api: string, yyymm: string): Set<string> | null {
  const found = new Set<string>();
  const jsonFiles = COUNTIES.map((c) => dir(`${api}-${yyymm}-${c}.json`)).filter((f) => fs.existsSync(f));
  const csv = dir(`${api}-${yyymm}.csv`);
  if (jsonFiles.length === 0 && !fs.existsSync(csv)) return null;
  for (const f of jsonFiles) {
    for (const r of JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, string>[]) {
      const d = districtByZh(r['site_id'] ?? '');
      if (d) found.add(d.code);
    }
  }
  if (fs.existsSync(csv)) {
    const [header, ...rows] = parseCsv(fs.readFileSync(csv, 'utf8'));
    const iSite = header?.findIndex((h) => h === 'site_id' || h === '區域別') ?? -1;
    for (const r of rows) {
      const d = districtByZh(r[iSite] ?? '');
      if (d) found.add(d.code);
    }
  }
  return found;
}

export const population: Source = {
  id: 'population',
  title: 'MOI household registration: monthly population and migration by village, 2015–2025',
  async download({ force }) {
    console.log('Population 2015–2017 (data.gov.tw 32973) and migration 2015-12..2017-12 (32975):');
    const pop = await datasetMeta(32973);
    const mig = await datasetMeta(32975);
    for (const [label, meta] of [['ODRP005', pop], ['ODRP002', mig]] as const) {
      for (const r of meta.distribution) {
        const m = r.resourceDescription.match(/^(10[4-6]\d\d)/);
        if (r.resourceFormat !== 'CSV' || !m) continue;
        const result = await downloadFile(r.resourceDownloadUrl, dir(`${label}-${m[1]}.csv`), { force, validate: notHtml });
        if (result.status !== 'skipped') logResult(`${label}-${m[1]}`, result);
      }
    }
    console.log('2018–2025 from the ris.gov.tw API (with CSV fallback for missing months):');
    for (const yyymm of rocMonthsBetween(2018, 2025)) {
      await downloadApiMonth(populationApi(yyymm), yyymm, force, 131138);
      await downloadApiMonth('ODRP011', yyymm, force, 77144);
    }
    console.log('Annual district migration (to cover 2015-01..2015-11):');
    logResult('Taipei a05002802', await downloadFile(
      'https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10300&kind=21&type=0&funid=a05002802&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1',
      raw('population', 'taipei-a05002802-cycle4.csv'), { force, validate: notHtml }));
    logResult('New Taipei 124872', await downloadFile(
      'https://data.ntpc.gov.tw/api/datasets/9c5b5e6f-2cfa-40f0-bc8f-172ad04471dc/csv/file',
      raw('population', 'ntpc-124872.csv'), { force, validate: notHtml }));
    console.log('Taipei monthly district population from 1998 (data.gov.tw 131723), for cross-checks:');
    logResult('Taipei a04000301', await downloadFile(
      'https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=8701&kind=21&type=0&funid=a04000301&cycle=1&outmode=12&compmode=0&outkind=3&deflst=2&nzo=1',
      raw('population', 'taipei-131723.csv'), { force, validate: notHtml }));
  },
  async check() {
    const report = (label: string, monthSources: (yyymm: string) => string[]) => {
      const gaps: string[] = [];
      for (const yyymm of rocMonthsBetween()) {
        let found: Set<string> | null = null;
        for (const api of monthSources(yyymm)) {
          const f = districtsInMonth(api, yyymm);
          if (f) found = new Set([...(found ?? []), ...f]);
        }
        if (!found) gaps.push(`${yyymm} (no file)`);
        else if (found.size < DISTRICTS.length) gaps.push(`${yyymm} (missing ${missingDistricts(found).map((d) => d.name).join(', ')})`);
      }
      console.log(`${label}: ${rocMonthsBetween().length - gaps.length}/132 months have all 41 districts`);
      gaps.forEach((g) => console.log(`  gap ${g}`));
    };
    report('Population', (m) => (Number(m) < 10701 ? ['ODRP005'] : [populationApi(m), 'ODRP010', 'ODRP060']));
    report('Migration', (m) => (Number(m) < 10701 ? ['ODRP002'] : ['ODRP011']));

    const ntpc = raw('population', 'ntpc-124872.csv');
    if (fs.existsSync(ntpc)) {
      const [header, ...rows] = parseCsv(fs.readFileSync(ntpc, 'utf8'));
      const i = (n: string) => header?.indexOf(n) ?? -1;
      const y2015 = rows.filter((r) => r[i('percent1')] === '2015' && districtByZh(`新北市${(r[i('percent2')] ?? '').trim()}`));
      console.log(`New Taipei annual migration 2015: ${y2015.length}/29 districts (percent3 = move-in, percent20 = move-out)`);
    }
    const tp = raw('population', 'taipei-a05002802-cycle4.csv');
    if (fs.existsSync(tp)) {
      const [header, ...rows] = parseCsv(fs.readFileSync(tp, 'utf8'));
      const cols = (header ?? []).filter((h) => h.startsWith('社會增加/遷入人數/總計[人]/') && !h.endsWith('總計')).length;
      console.log(`Taipei annual migration: years ${rows.map((r) => r[0]).filter(Boolean).join(' ')}; move-in columns for ${cols}/12 districts`);
    }
  },
};
