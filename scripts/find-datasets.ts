/**
 * Searches the data.gov.tw catalog export (about 70 MB, cached in data/raw/_meta/) by title.
 *
 *   node scripts/find-datasets.ts "<title regex>" ["<agency regex>"] [--refresh]
 *   node scripts/find-datasets.ts "租金|房租" "臺北市|新北市"
 */
import fs from 'node:fs';
import { parseCsv } from './lib/csv.ts';
import { downloadFile } from './lib/http.ts';
import { raw } from './lib/paths.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length === 0) {
  console.log('Usage: node scripts/find-datasets.ts "<title regex>" ["<agency regex>"] [--refresh]');
  process.exit(0);
}
const file = raw('_meta', 'datagov-all.csv');
const result = await downloadFile('https://data.gov.tw/datasets/export/csv', file, {
  force: process.argv.includes('--refresh'),
  minBytes: 1_000_000,
});
if (result.status === 'failed') throw new Error(`catalog download failed: ${result.error}`);

const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
const col = (name: string) => header?.indexOf(name) ?? -1;
const title = new RegExp(args[0]!);
const agency = args[1] ? new RegExp(args[1]) : undefined;
let hits = 0;
for (const r of rows) {
  if (!title.test(r[col('資料集名稱')] ?? '')) continue;
  if (agency && !agency.test(r[col('提供機關')] ?? '')) continue;
  hits++;
  const formats = [...new Set((r[col('檔案格式')] ?? '').split(';'))].join(';');
  console.log([r[col('資料集識別碼')], r[col('資料集名稱')], r[col('提供機關')], formats, r[col('更新頻率')], r[col('授權方式')]].join(' | '));
}
console.log(`${hits} datasets`);
