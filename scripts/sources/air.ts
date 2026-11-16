/**
 * Air-quality monitoring, Ministry of Environment (data.moenv.gov.tw, OGDL v1).
 *   - aqx_p_07: station list with county, district and coordinates (data.gov.tw 6075)
 *   - aqx_p_13: one row per station, pollutant and day with 24 hourly values, from 2013-12 (28178)
 *
 * Requires a free personal API key in the environment variable MOENV_API_KEY. The key is never
 * written to disk or printed. The API allows 5,000 calls per day per key.
 *
 * Flags: --items=PM2.5,PM10 (default PM2.5)
 */
import fs from 'node:fs';
import { DISTRICTS, districtByZh, missingDistricts } from '../lib/districts.ts';
import { sleep } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import type { Source } from './types.ts';

export interface Station {
  readonly siteid: string;
  readonly sitename: string;
  readonly siteengname: string;
  readonly county: string;
  readonly township: string;
  readonly sitetype: string;
  readonly twd97lon: string;
  readonly twd97lat: string;
}

export interface DailyRow {
  readonly monitordate: string;
  readonly [hour: `monitorvalue${string}`]: string;
}

function apiKey(): string {
  const key = process.env['MOENV_API_KEY'];
  if (!key) {
    throw new Error('Set MOENV_API_KEY (free key from https://data.moenv.gov.tw). PowerShell: $env:MOENV_API_KEY="..."; Git Bash: export MOENV_API_KEY=...');
  }
  return key;
}

async function api<T>(dataset: string, query: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `https://data.moenv.gov.tw/api/v2/${dataset}?api_key=${apiKey()}&format=JSON&limit=1000&offset=${offset}${query}`;
    const text = await (await fetch(url)).text();
    if (!/^\s*[[{]/.test(text)) throw new Error(`${dataset}: ${text.slice(0, 120)}`); // quota or key errors are plain text
    const parsed = JSON.parse(text) as T[] | { records?: T[] };
    const page = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
    rows.push(...page);
    if (page.length < 1000) return rows;
    await sleep(200);
  }
}

const stationsFile = raw('air', 'moenv-aqx_p_07.json');
const itemDir = (item: string) => raw('air', `aqx_p_13-${item.replace(/\W/g, '')}`);

export function localStations(): Station[] {
  if (!fs.existsSync(stationsFile)) return [];
  return (JSON.parse(fs.readFileSync(stationsFile, 'utf8')) as Station[]).filter((s) => s.county === '臺北市' || s.county === '新北市');
}

/** Days per year with at least one valid hourly value, de-duplicated by date. */
export function validDaysByYear(rows: readonly DailyRow[]): Map<string, number> {
  const days = new Set<string>();
  for (const r of rows) {
    const valid = Object.entries(r).some(([k, v]) => k.startsWith('monitorvalue') && /^-?\d+(\.\d+)?$/.test(String(v).trim()));
    if (valid) days.add(r.monitordate.trim().slice(0, 10));
  }
  const byYear = new Map<string, number>();
  for (const d of days) byYear.set(d.slice(0, 4), (byYear.get(d.slice(0, 4)) ?? 0) + 1);
  return byYear;
}

function items(flags: Readonly<Record<string, string | true>>): string[] {
  const v = flags['items'];
  return typeof v === 'string' ? v.split(',') : ['PM2.5'];
}

export const air: Source = {
  id: 'air',
  title: 'MOENV air-quality stations and hourly values (needs MOENV_API_KEY)',
  async download({ force, flags }) {
    if (force || !fs.existsSync(stationsFile)) {
      const stations = await api<Station>('aqx_p_07', '');
      fs.mkdirSync(raw('air'), { recursive: true });
      fs.writeFileSync(stationsFile, JSON.stringify(stations, null, 1));
      console.log(`  stations: ${stations.length}`);
    }
    for (const item of items(flags)) {
      for (const s of localStations()) {
        const file = `${itemDir(item)}/${s.siteid}-${s.siteengname}.json`;
        if (!force && fs.existsSync(file)) continue;
        const rows = await api<DailyRow>('aqx_p_13', `&sort=monitordate%20asc&filters=siteid,EQ,${s.siteid}|itemengname,EQ,${encodeURIComponent(item)}`);
        fs.mkdirSync(itemDir(item), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(rows));
        console.log(`  ${item} ${s.siteengname}: ${rows.length} days`);
      }
    }
  },
  async check({ flags }) {
    const stations = localStations();
    const withStation = new Set<string>();
    for (const item of items(flags)) {
      console.log(`${item}: valid days per year 2015..2025`);
      for (const s of stations) {
        const d = districtByZh(s.county + s.township);
        if (d) withStation.add(d.code);
        const file = `${itemDir(item)}/${s.siteid}-${s.siteengname}.json`;
        if (!fs.existsSync(file)) {
          console.log(`  ${s.siteengname}: not downloaded`);
          continue;
        }
        const byYear = validDaysByYear(JSON.parse(fs.readFileSync(file, 'utf8')) as DailyRow[]);
        const years = Array.from({ length: 11 }, (_, i) => String(2015 + i)).map((y) => byYear.get(y) ?? 0);
        console.log(`  ${s.siteengname} (${d?.name ?? s.township}, ${s.sitetype}): ${years.join(' ')}`);
      }
    }
    const without = missingDistricts(withStation);
    console.log(`districts with a station: ${DISTRICTS.length - without.length}/41; without: ${without.map((d) => d.name).join(', ')}`);
  },
};
