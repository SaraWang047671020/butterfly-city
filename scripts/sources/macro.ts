/**
 * Macro series (all OGDL v1):
 *   - Central Bank policy rates (data.gov.tw 6022, 10783) and five-bank new loan rates incl.
 *     home-purchase loans (6551)
 *   - DGBAS national CPI basic groups incl. rent (6019) and item groups (9158), base 2021 = 100
 *   - Taipei City CPI basic groups incl. rent (131822, Taipei DBAS)
 */
import fs from 'node:fs';
import { parseCsv } from '../lib/csv.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

const FILES = [
  { name: 'cbc-webF1-discount-rate.csv', url: 'https://www.cbc.gov.tw/Public/Data/opendata/webF1.csv' },
  { name: 'cbc-EG28D01-policy-rates-daily.csv', url: 'https://www.cbc.gov.tw/public/data/OpenData/經研處/EG28D01.csv' },
  { name: 'cbc-EH45M01-five-banks-new-loans-monthly.csv', url: 'https://www.cbc.gov.tw/public/data/OpenData/經研處/EH45M01.csv' },
  { name: 'dgbas-pr0101a1m-cpi-basic.xml', url: 'https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230555/pr0101a1m.xml' },
  { name: 'dgbas-pr0101a3m-cpi-items.xml', url: 'https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230543/pr0101a3m.xml' },
  {
    name: 'taipei-A21000102-cpi-monthly.csv',
    url: 'https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10301&kind=21&type=0&funid=A21000102&cycle=1&outmode=12&compmode=00&outkind=3&deflst=2',
  },
] as const;

/** Decodes a CSV that may be UTF-8 or Big5 (some Central Bank files). */
function decode(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? new TextDecoder('big5').decode(buf) : utf8;
}

function csvRange(name: string): string {
  const rows = parseCsv(decode(fs.readFileSync(raw('macro', name)))).filter((r) => r.length > 1);
  const firstCol = rows.slice(1).map((r) => r[0] ?? '');
  return `${rows.length - 1} rows, ${firstCol[0]} .. ${firstCol[firstCol.length - 1]} (header: ${rows[0]?.slice(0, 3).join(', ')})`;
}

function xmlRange(name: string): string {
  const text = fs.readFileSync(raw('macro', name), 'utf8');
  const periods = [...text.matchAll(/<TIME_PERIOD>([^<]+)<\/TIME_PERIOD>/g)].map((m) => m[1] ?? '').sort();
  const items = new Set([...text.matchAll(/<Item>([^<]+)<\/Item>/g)].map((m) => m[1] ?? ''));
  const rent = [...items].filter((i) => /房租|住宅租金/.test(i));
  return `${periods[0]} .. ${periods[periods.length - 1]}, ${items.size} items, rent items: ${rent.join(' | ')}`;
}

export const macro: Source = {
  id: 'macro',
  title: 'Central Bank rates, five-bank home loan rates, DGBAS CPI, Taipei CPI',
  async download({ force }) {
    for (const f of FILES) logResult(f.name, await downloadFile(f.url, raw('macro', f.name), { force, validate: notHtml }));
  },
  async check() {
    for (const f of FILES) {
      if (!fs.existsSync(raw('macro', f.name))) {
        console.log(`${f.name}: not downloaded`);
        continue;
      }
      console.log(`${f.name}: ${f.name.endsWith('.xml') ? xmlRange(f.name) : csvRange(f.name)}`);
    }
  },
};
