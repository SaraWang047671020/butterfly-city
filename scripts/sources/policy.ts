/**
 * Policy raw files for the rent subsidy tool and the holding-tax revenue context (data/raw/policy/housing/).
 * Retrieved 2026-06 (the existing files were hand-fetched earlier; this module reproduces them).
 *   - MOI Real Estate Information Platform, statistics query Info/E3010, JSON. The endpoint is not documented
 *     and states no license. Query: dataScope, f01 = type (6), f02 = kind (6_1 or 6_3), f03 = table id,
 *     f04 / f05 = first / last quarter (ROC year + Q), location = city codes joined by "-" (A = Taipei,
 *     F = New Taipei).
 *       6_1_3  rent subsidy households, old program (applications up to 110), 104Q1 – 114Q4
 *       6_3_1  rent subsidy households, 300億 program (payments from 111 Q4), 111Q4 – 114Q4
 *   - data.gov.tw 169800 接受住宅補貼戶次及金額 (MOI / NLMA, OGDL v1): CSV URL taken from the dataset metadata.
 *   - data.gov.tw 6742 全國賦稅收入實徵淨額日曆年別 (MOF, OGDL v1): CSV URL taken from the dataset metadata.
 */
import fs from 'node:fs';
import { datasetMeta } from '../lib/datagov.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

const E3010_ENDPOINT = 'https://pip.moi.gov.tw/Publicize/Info/E30Query';
const E3010_SCOPE = '全國縣市統計資訊';
/** Taipei City (A) and New Taipei City (F), in the form the query endpoint expects. */
const E3010_LOCATION = 'A-F-';

export interface E3010Table {
  readonly file: string;
  readonly kind: string;
  readonly table: string;
  readonly from: string;
  readonly to: string;
}

export const E3010_TABLES: readonly E3010Table[] = [
  { file: 'pip-e3010-6_1_3-taipei-newtaipei.json', kind: '6_1', table: '6_1_3', from: '104Q1', to: '114Q4' },
  { file: 'pip-e3010-6_3_1-taipei-newtaipei.json', kind: '6_3', table: '6_3_1', from: '111Q4', to: '114Q4' },
];

export const DATAGOV_FILES = [
  { file: 'datagov-169800.csv', datasetId: 169800 },
  { file: 'datagov-6742.csv', datasetId: 6742 },
] as const;

/** Builds the E3010 query URL for one table. */
export function e3010Url(t: Pick<E3010Table, 'kind' | 'table' | 'from' | 'to'>): string {
  const q = new URLSearchParams({ dataScope: E3010_SCOPE, f01: t.table.split('_')[0]!, f02: t.kind, f03: t.table, f04: t.from, f05: t.to });
  // The location list keeps its "-" separators unescaped, as the site's own script sends it.
  return `${E3010_ENDPOINT}?${q.toString()}&location=${E3010_LOCATION}`;
}

/** Rejects an E3010 response that carries no table (the endpoint answers 200 with nulls for bad queries). */
export function validateE3010(body: Buffer): string | undefined {
  try {
    const j = JSON.parse(body.toString('utf8')) as { resultTable?: unknown };
    return Array.isArray(j.resultTable) && j.resultTable.length > 1 ? undefined : 'no resultTable in response';
  } catch {
    return 'not JSON';
  }
}

const dir = (name: string) => raw('policy', 'housing', name);

/** Counts non-empty CSV lines (data rows plus header); quoted newlines do not occur in these files. */
export function countLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').length;
}

export const policy: Source = {
  id: 'policy',
  title: 'Rent subsidy households (MOI E3010 6_1_3, 6_3_1), subsidy amounts (169800), tax revenue (MOF 6742)',
  async download({ force }) {
    for (const t of E3010_TABLES) {
      logResult(t.table, await downloadFile(e3010Url(t), dir(t.file), { force, minBytes: 500, validate: validateE3010 }));
    }
    for (const f of DATAGOV_FILES) {
      if (!force && fs.existsSync(dir(f.file)) && fs.statSync(dir(f.file)).size > 0) {
        logResult(`data.gov.tw ${f.datasetId}`, { status: 'skipped', bytes: fs.statSync(dir(f.file)).size });
        continue;
      }
      try {
        const csv = (await datasetMeta(f.datasetId)).distribution.find((r) => r.resourceFormat === 'CSV');
        if (!csv) throw new Error('no CSV resource in the dataset metadata');
        logResult(`data.gov.tw ${f.datasetId}`, await downloadFile(csv.resourceDownloadUrl, dir(f.file), { force, validate: notHtml }));
      } catch (e) {
        logResult(`data.gov.tw ${f.datasetId}`, { status: 'failed', error: (e as Error).message });
      }
    }
  },
  async check() {
    for (const t of E3010_TABLES) {
      const file = dir(t.file);
      if (!fs.existsSync(file)) {
        console.log(`${t.file}: MISSING`);
        continue;
      }
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { resultTable: string[][] };
      const header = j.resultTable[0]!;
      console.log(`${t.file}: ${fs.statSync(file).size} bytes; ${j.resultTable.length - 1} cities (${j.resultTable.slice(1).map((r) => r[0]).join(', ')}); ` +
        `${header.length - 1} quarters ${header[1]} – ${header[header.length - 1]}`);
    }
    for (const f of DATAGOV_FILES) {
      const file = dir(f.file);
      if (!fs.existsSync(file)) {
        console.log(`${f.file}: MISSING`);
        continue;
      }
      console.log(`${f.file}: ${fs.statSync(file).size} bytes; ${countLines(fs.readFileSync(file, 'utf8')) - 1} data rows`);
    }
  },
};
