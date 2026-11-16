/**
 * Real-price registration (實價登錄), MOI Department of Land Administration.
 * data.gov.tw 25119 (sales) and 25118 (rentals), OGDL v1.
 *
 * Season files hold records PUBLISHED in that season, so counts are re-bucketed by the transaction
 * date column. Seasons are downloaded until three quarters after 2025 so late registrations of
 * 2025 transactions are included.
 */
import fs from 'node:fs';
import { parseCsv } from '../lib/csv.ts';
import { DISTRICTS, districtByZh } from '../lib/districts.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { adToRoc, quartersBetween, rocDateToQuarter, type Quarter } from '../lib/time.ts';
import { logResult, type Source } from './types.ts';

/** City prefixes in file names: a = Taipei, f = New Taipei. */
const CITIES = [
  { prefix: 'a', zh: '臺北市' },
  { prefix: 'f', zh: '新北市' },
] as const;
/** File types: a = sales (existing and new buildings), c = rentals. Pre-sale (b) is not used. */
const KINDS = ['a', 'c'] as const;
type Kind = (typeof KINDS)[number];

function seasons(): string[] {
  const out: string[] = [];
  for (let y = 2015; y <= 2026; y++) for (let q = 1; q <= 4; q++) out.push(`${adToRoc(y)}S${q}`);
  return out;
}

const fileName = (season: string, city: string, kind: Kind) => `${season}_${city}_lvr_land_${kind}.csv`;

export interface QuarterCount {
  all: number;
  residential: number;
}

/**
 * Counts building transactions per district code and transaction quarter across season files,
 * de-duplicated by the record id (編號). "Residential" means 主要用途 contains 住.
 */
export function countByQuarter(files: readonly { cityZh: string; text: string }[]): {
  counts: Map<string, Map<Quarter, QuarterCount>>;
  duplicates: number;
} {
  const counts = new Map<string, Map<Quarter, QuarterCount>>();
  const seen = new Set<string>();
  let duplicates = 0;
  for (const { cityZh, text } of files) {
    const [header, , ...rows] = parseCsv(text); // second row is an English header
    if (!header) continue;
    const col = (name: string) => header.indexOf(name);
    const iDistrict = col('鄉鎮市區');
    const iTarget = col('交易標的');
    const iDate = header.findIndex((h) => h === '交易年月日' || h === '租賃年月日');
    const iUse = col('主要用途');
    const iId = col('編號');
    for (const r of rows) {
      const target = r[iTarget] ?? '';
      if (!target.includes('建物') && !target.includes('房')) continue; // building transactions only
      const id = r[iId] ?? '';
      if (id && seen.has(id)) {
        duplicates++;
        continue;
      }
      seen.add(id);
      const district = districtByZh(cityZh + (r[iDistrict] ?? ''));
      const quarter = rocDateToQuarter(r[iDate] ?? '');
      if (!district || !quarter) continue;
      const perDistrict = counts.get(district.code) ?? new Map<Quarter, QuarterCount>();
      counts.set(district.code, perDistrict);
      const c = perDistrict.get(quarter) ?? { all: 0, residential: 0 };
      perDistrict.set(quarter, c);
      c.all++;
      if ((r[iUse] ?? '').includes('住')) c.residential++;
    }
  }
  return { counts, duplicates };
}

function readKind(kind: Kind): { cityZh: string; text: string }[] {
  const dir = raw('lvr');
  if (!fs.existsSync(dir)) return [];
  const out: { cityZh: string; text: string }[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(/^\d+S\d_([af])_lvr_land_([ac])\.csv$/);
    if (!m || m[2] !== kind) continue;
    const city = CITIES.find((c) => c.prefix === m[1]);
    if (city) out.push({ cityZh: city.zh, text: fs.readFileSync(`${dir}/${name}`, 'utf8') });
  }
  return out;
}

export const lvr: Source = {
  id: 'lvr',
  title: 'MOI real-price registration, sales and rentals, Taipei + New Taipei, seasons 2015S1–2026S4',
  async download({ force }) {
    for (const season of seasons()) {
      for (const city of CITIES) {
        for (const kind of KINDS) {
          const name = fileName(season, city.prefix, kind);
          const url = `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&fileName=${city.prefix}_lvr_land_${kind}.csv`;
          // Unpublished seasons return a ~441-byte error page.
          const result = await downloadFile(url, raw('lvr', name), {
            force,
            minBytes: 1000,
            validate: (b) => (b.length < 1000 ? 'season not published yet' : notHtml(b)),
          });
          logResult(name, result);
        }
      }
    }
  },
  async check() {
    const quarters = quartersBetween();
    for (const kind of KINDS) {
      const { counts, duplicates } = countByQuarter(readKind(kind));
      const label = kind === 'a' ? 'SALES' : 'RENTALS';
      console.log(`\n${label}, residential building transactions by transaction quarter (duplicates skipped: ${duplicates})`);
      console.log('district | min per quarter | quarters = 0 | quarters < 5 | quarters < 10 | total 2015–2025 | 2015 | 2020 | 2025');
      for (const d of DISTRICTS) {
        const per = counts.get(d.code);
        const values = quarters.map((q) => per?.get(q)?.residential ?? 0);
        const year = (y: number) => quarters.filter((q) => q.startsWith(String(y))).reduce((s, q) => s + (per?.get(q)?.residential ?? 0), 0);
        console.log(
          [d.name, Math.min(...values), values.filter((v) => v === 0).length, values.filter((v) => v < 5).length,
            values.filter((v) => v < 10).length, values.reduce((a, b) => a + b, 0), year(2015), year(2020), year(2025)].join(' | '),
        );
      }
      const out = raw('_check', `lvr-${kind}-by-quarter.json`);
      fs.mkdirSync(raw('_check'), { recursive: true });
      const serializable = Object.fromEntries([...counts].map(([code, m]) => [code, Object.fromEntries(m)]));
      fs.writeFileSync(out, JSON.stringify(serializable));
    }
  },
};
