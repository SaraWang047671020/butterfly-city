/**
 * Taipei Metro station entries and exits (Taipei Rapid Transit Corporation via data.taipei, OGDL v1).
 *   - data.gov.tw 128683: daily entries / exits per station, one file per month, 2015-01..2016-12 (Big5)
 *   - data.gov.tw 128506: hourly origin–destination trips, one file per month, 2017-01 onward (~300 MB each)
 *   - data.gov.tw 133184: annual entries / exits per station (Taipei DBAS statistics database)
 *
 * Hourly OD files are only fetched with --od=YYYY-MM[,YYYY-MM...] or --od=all. Each one is streamed,
 * summed to station-month entries and exits, and written as a small JSON file; the raw CSV is not kept.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { parseCsvObjects } from '../lib/csv.ts';
import { datasetMeta } from '../lib/datagov.ts';
import { BROWSER_UA, downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

const ANNUAL_URL =
  'https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10300&kind=21&type=0&funid=a05023601&cycle=4&outmode=12&compmode=0&outkind=3&deflst=2&nzo=1';

interface IndexRow {
  readonly item: string;
  readonly year: number;
  readonly month: number;
  readonly url: string;
}

const monthTag = (r: { year: number; month: number }) => `${r.year}-${String(r.month).padStart(2, '0')}`;

async function readIndex(datasetId: number): Promise<IndexRow[]> {
  const meta = await datasetMeta(datasetId);
  const resource = meta.distribution[0];
  if (!resource) throw new Error(`dataset ${datasetId} has no resource`);
  const file = raw('mrt', `taipei-${datasetId}-index.csv`);
  // Always refresh the index: it gains a row every month.
  logResult(`index ${datasetId}`, await downloadFile(resource.resourceDownloadUrl, file, { force: true, validate: notHtml }));
  return parseIndex(fs.readFileSync(file, 'utf8'));
}

/** Index CSV columns: [SeqNo, 項目 (128683 only), 西元年, 月, URL]. */
export function parseIndex(text: string): IndexRow[] {
  return parseCsvObjects(text).map((r) => ({
    item: r['項目'] ?? 'OD',
    year: Number(r['西元年']),
    month: Number(r['月']),
    url: r['URL'] ?? '',
  }));
}

/** Streams one hourly OD CSV (日期,時段,進站,出站,人次) and sums trips by entry and by exit station. */
export async function aggregateOd(lines: AsyncIterable<string>): Promise<{
  entries: Record<string, number>;
  exits: Record<string, number>;
  rows: number;
  days: number;
}> {
  const entries: Record<string, number> = {};
  const exits: Record<string, number> = {};
  const days = new Set<string>();
  let rows = 0;
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false; // header row
      continue;
    }
    const [date, , from, to, trips] = line.split(',');
    if (!date || !from || !to) continue;
    const n = Number(trips) || 0;
    rows++;
    days.add(date);
    entries[from] = (entries[from] ?? 0) + n;
    exits[to] = (exits[to] ?? 0) + n;
  }
  return { entries, exits, rows, days: days.size };
}

async function downloadOdMonth(row: IndexRow, force: boolean): Promise<void> {
  const tag = monthTag(row);
  const out = raw('mrt', 'od-station-month', `${tag}.json`);
  if (!force && fs.existsSync(out)) return;
  const res = await fetch(row.url.replace(/^http:/, 'https:'), { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok || !res.body) {
    console.log(`  OD ${tag}: FAILED HTTP ${res.status}`);
    return;
  }
  const lines = readline.createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
  const agg = await aggregateOd(lines);
  fs.mkdirSync(raw('mrt', 'od-station-month'), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ month: tag, source: row.url, ...agg }));
  console.log(`  OD ${tag}: ${agg.rows} rows, ${Object.keys(agg.entries).length} stations`);
}

export const mrt: Source = {
  id: 'mrt',
  title: 'Taipei Metro station entries/exits: daily 2015–2016, hourly OD 2017+ (opt-in), annual 2014+',
  async download({ force, flags }) {
    const daily = await readIndex(128683);
    for (const r of daily.filter((x) => !x.item.includes('分時'))) {
      const kind = r.item.includes('出站') ? 'exits' : 'entries';
      const name = `taipei-${kind}-${monthTag(r)}.csv`;
      const result = await downloadFile(r.url.replace(/^http:/, 'https:'), raw('mrt', 'daily', name), { force, validate: notHtml });
      if (result.status !== 'skipped') logResult(name, result);
    }
    logResult('annual per station (133184)', await downloadFile(ANNUAL_URL, raw('mrt', 'taipei-133184-annual-station.csv'), { force, validate: notHtml }));

    const od = await readIndex(128506);
    const wanted = flags['od'];
    if (!wanted) {
      console.log(`  hourly OD: ${od.length} monthly files listed; pass --od=YYYY-MM or --od=all to aggregate (about 300 MB each)`);
      return;
    }
    const months = wanted === true || wanted === 'all' ? null : new Set(String(wanted).split(','));
    for (const r of od) if (!months || months.has(monthTag(r))) await downloadOdMonth(r, force);
  },
  async check() {
    for (const id of [128683, 128506]) {
      const file = raw('mrt', `taipei-${id}-index.csv`);
      if (!fs.existsSync(file)) continue;
      const months = parseIndex(fs.readFileSync(file, 'utf8')).map(monthTag).sort();
      console.log(`index ${id}: ${months.length} files, ${months[0]} .. ${months[months.length - 1]}`);
    }
    const dailyDir = raw('mrt', 'daily');
    if (fs.existsSync(dailyDir)) console.log(`daily files downloaded: ${fs.readdirSync(dailyDir).length} (expected 48)`);
    const annual = raw('mrt', 'taipei-133184-annual-station.csv');
    if (fs.existsSync(annual)) {
      const byYear = new Map<string, number>();
      for (const r of parseCsvObjects(fs.readFileSync(annual, 'utf8'))) {
        const year = r['統計期'] ?? '';
        if (Number(r['進站人次']) > 0) byYear.set(year, (byYear.get(year) ?? 0) + 1);
      }
      console.log(`annual series, stations with entries > 0: ${[...byYear].map(([y, n]) => `${y}:${n}`).join(' ')}`);
    }
    const odDir = raw('mrt', 'od-station-month');
    if (fs.existsSync(odDir)) {
      for (const f of fs.readdirSync(odDir)) {
        const j = JSON.parse(fs.readFileSync(`${odDir}/${f}`, 'utf8')) as { month: string; entries: Record<string, number>; rows: number };
        console.log(`OD ${j.month}: ${Object.keys(j.entries).length} stations, ${j.rows} rows`);
      }
    }
  },
};
