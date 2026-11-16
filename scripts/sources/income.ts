/**
 * Income: comprehensive income tax statistics by village, Fiscal Information Agency (MOF).
 * data.gov.tw 103066. One CSV per income year; each district has a `合計` (total) row with the median.
 */
import fs from 'node:fs';
import { parseCsvObjects, parseNumber } from '../lib/csv.ts';
import { datasetMeta } from '../lib/datagov.ts';
import { DISTRICTS, districtByZh } from '../lib/districts.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { adToRoc } from '../lib/time.ts';
import { logResult, type Source } from './types.ts';

const YEARS = Array.from({ length: 2025 - 2014 + 1 }, (_, i) => 2014 + i);
const url = (roc: number) => `https://www.fia.gov.tw/WEB/fia/ias/ias${roc}/${roc}_165-9.csv`;
const file = (roc: number) => raw('income', `${roc}_165-9.csv`);

export interface DistrictIncomeRow {
  readonly code: string;
  readonly households: number;
  readonly median: number;
}

/** Extracts the district total rows (村里 = 合計) for the 41 districts from one year's CSV. */
export function districtTotals(csvText: string): DistrictIncomeRow[] {
  const rows = parseCsvObjects(csvText);
  const out: DistrictIncomeRow[] = [];
  for (const r of rows) {
    if (r['村里'] !== '合計') continue;
    // The first column is named 鄉鎮市區 up to ROC 109 and 縣市別 from ROC 110.
    const d = districtByZh(r['鄉鎮市區'] ?? r['縣市別'] ?? '');
    if (!d) continue;
    out.push({ code: d.code, households: parseNumber(r['納稅單位(戶)'] ?? ''), median: parseNumber(r['中位數'] ?? '') });
  }
  return out;
}

export const income: Source = {
  id: 'income',
  title: 'MOF comprehensive income tax by village (district medians), 2014–2025',
  async download({ force }) {
    for (const year of YEARS) {
      const roc = adToRoc(year);
      logResult(`${year} (${roc})`, await downloadFile(url(roc), file(roc), { force, minBytes: 10_000, validate: notHtml }));
    }
    // City-level trend (decision 1): DGBAS Family Income and Expenditure Survey, average disposable
    // income per household by county, data.gov.tw 9415 (OGDL v1).
    const dgbas = (await datasetMeta(9415)).distribution[0];
    if (dgbas) {
      logResult('DGBAS 9415 disposable income by county', await downloadFile(encodeURI(decodeURI(dgbas.resourceDownloadUrl)),
        raw('income', 'dgbas-9415-disposable-income-by-region.csv'), { force, validate: notHtml }));
    }
  },
  async check() {
    const sample = ['63000030', '63000070', '65000010', '65000200'];
    const names = sample.map((c) => DISTRICTS.find((d) => d.code === c)?.name).join(' / ');
    console.log(`year  districts  median (NT$ thousand): ${names}`);
    for (const year of YEARS) {
      const roc = adToRoc(year);
      if (!fs.existsSync(file(roc))) {
        console.log(`${year}  not downloaded (or not published)`);
        continue;
      }
      const totals = districtTotals(fs.readFileSync(file(roc), 'utf8'));
      const medians = sample.map((c) => totals.find((t) => t.code === c)?.median ?? '-').join(' / ');
      console.log(`${year}  ${new Set(totals.map((t) => t.code)).size}/41      ${medians}`);
    }
    const dgbas = raw('income', 'dgbas-9415-disposable-income-by-region.csv');
    if (fs.existsSync(dgbas)) {
      const rows = parseCsvObjects(fs.readFileSync(dgbas, 'utf8')).filter((r) => Number(r['年']) >= 2015);
      console.log('DGBAS average disposable income per household (NT$): year Taipei / New Taipei');
      for (const r of rows) console.log(`  ${r['年']}  ${r['臺北市-元']} / ${r['新北市-元']}`);
    }
  },
};
