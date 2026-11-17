/**
 * MOI low-use (low electricity use) housing statistics by district, Real Estate Information
 * Platform (內政部不動產資訊平台), page https://pip.moi.gov.tw/Publicize/Info/E1040
 * ("低度使用(用電)住宅、待售新成屋"). Publisher: Ministry of the Interior (statistics department
 * since ROC 109). License: not stated on the page.
 *
 * A dwelling is low-use when its average monthly electricity use is at or below 60 kWh
 * (Nov-Dec average for the second half, May-Jun average for the first half; before ROC 109 one
 * annual figure, based on Nov-Dec).
 *
 * The page offers a form that POSTs to the same URL and answers with a CSV file (columns:
 * county, district, "<period>宅數", "<period>比率(%)"). The form needs the anti-forgery token and
 * cookie of the page itself, and a browser User-Agent.
 *   F01 = DataGroup3 ("current method": annual ROC 98-108, half-years ROC 109H1 onward)
 *   F01 = DataGroup1 ("original method": annual ROC 98-108, 109H1, 109H2)
 *   F02 = period (ROC year, with H1 / H2 from 109 on; annual years have no suffix)
 *   F03 = county code (63000 Taipei, 65000 New Taipei)
 * One file is saved per method group, period and county.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseCsv, parseNumber } from '../lib/csv.ts';
import { DISTRICTS, districtByZh } from '../lib/districts.ts';
import { BROWSER_UA, notHtml, sleep } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

const execFileAsync = promisify(execFile);
const PAGE = 'https://pip.moi.gov.tw/Publicize/Info/E1040';
const WAF_REJECTION = /Request Rejected|The requested URL was rejected/;
const dir = (...p: string[]) => raw('low-use', ...p);

export const COUNTIES = [
  { code: '63000', name: 'Taipei' },
  { code: '65000', name: 'New Taipei' },
] as const;

export interface MethodGroup {
  readonly form: string;
  readonly id: string;
  readonly label: string;
  /** Periods offered by the page, as written in the form (ROC year, annual years without suffix). */
  readonly periods: readonly string[];
}

const ANNUAL = ['104', '105', '106', '107', '108'];
const HALF = (from: number, to: number): string[] => {
  const out: string[] = [];
  for (let y = from; y <= to; y++) out.push(`${y}H1`, `${y}H2`);
  return out;
};

/** Periods from ROC 104 (2015) to ROC 114H2 (2025H2). */
export const GROUPS: readonly MethodGroup[] = [
  { form: 'DataGroup3', id: 'current', label: 'current method', periods: [...ANNUAL, ...HALF(109, 114)] },
  { form: 'DataGroup1', id: 'original', label: 'original method', periods: [...ANNUAL, '109H1', '109H2'] },
];

const fileName = (group: MethodGroup, period: string, county: string) => `moi-low-use-${group.id}-${period}-${county}.csv`;

/** Converts a form period (ROC year, optional H1/H2) to `YYYYH1` / `YYYYH2`. An annual year maps to H2 (Nov-Dec basis). */
export function toLowUsePeriod(rocPeriod: string): string | undefined {
  const m = rocPeriod.trim().match(/^(\d{2,3})(H[12])?$/);
  if (!m) return undefined;
  return `${Number(m[1]) + 1911}${m[2] ?? 'H2'}`;
}

export interface LowUseRow {
  readonly zh: string;
  readonly period: string;
  readonly count: number;
  readonly ratePercent: number;
}

/** Parses one downloaded CSV. Throws on a missing column. Rows with a non-numeric count are kept with NaN. */
export function parseLowUseCsv(text: string): LowUseRow[] {
  const [header, ...rows] = parseCsv(text);
  const countCol = header?.findIndex((h) => h.endsWith('宅數')) ?? -1;
  const rateCol = header?.findIndex((h) => h.includes('比率')) ?? -1;
  if (!header || header[0] !== '縣市' || header[1] !== '鄉鎮市區' || countCol < 0 || rateCol < 0) {
    throw new Error(`unexpected header: ${header?.join(',') ?? '(empty)'}`);
  }
  const period = header[countCol]!.replace('宅數', '').trim();
  return rows
    .filter((r) => r.length >= 4)
    .map((r) => ({ zh: `${r[0]!.trim()}${r[1]!.trim()}`, period, count: parseNumber(r[countCol]!), ratePercent: parseNumber(r[rateCol]!) }));
}

function validateCsv(body: Buffer): string | undefined {
  const html = notHtml(body);
  if (html) return html;
  const head = body.toString('utf8').replace(/^\uFEFF/, '').slice(0, 40);
  return head.startsWith('"縣市","鄉鎮市區"') ? undefined : `not the expected CSV (starts with ${JSON.stringify(head)})`;
}

export interface Session {
  post(form: string, period: string, county: string): Promise<Buffer>;
}

async function openFetchSession(): Promise<Session> {
  const res = await fetch(PAGE, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } });
  const html = await res.text();
  if (!res.ok || html.length < 5000 || WAF_REJECTION.test(html)) throw new Error(`page request rejected (HTTP ${res.status})`);
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error('anti-forgery token not found on the page');
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return {
    async post(form, period, county) {
      const body = new URLSearchParams({ F01: form, F02: period, F03: county, F04: '', F05: '', F06: '', __RequestVerificationToken: token });
      const r = await fetch(PAGE, {
        method: 'POST',
        body,
        headers: { 'User-Agent': BROWSER_UA, Cookie: cookie, Referer: PAGE, Origin: 'https://pip.moi.gov.tw' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

/** Same session through the system curl, used when Node's fetch is rejected by the firewall. */
async function openCurlSession(): Promise<Session> {
  const jar = path.join(os.tmpdir(), `butterflycity-pip-${process.pid}.cookies`);
  const run = async (args: string[]) => (await execFileAsync('curl', ['-s', '-L', '--fail', '-A', BROWSER_UA, '-b', jar, '-c', jar, ...args], { encoding: 'buffer', maxBuffer: 2 ** 28 })).stdout;
  const html = (await run([PAGE])).toString('utf8');
  if (html.length < 5000 || WAF_REJECTION.test(html)) throw new Error('page request rejected by the firewall (curl)');
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error('anti-forgery token not found on the page');
  return {
    async post(form, period, county) {
      return run(['-e', PAGE, '-H', 'Origin: https://pip.moi.gov.tw', '--data-urlencode', `F01=${form}`, '--data-urlencode', `F02=${period}`,
        '--data-urlencode', `F03=${county}`, '--data-urlencode', `__RequestVerificationToken=${token}`, PAGE]);
    },
  };
}

export async function openSession(): Promise<Session> {
  try {
    return await openFetchSession();
  } catch (fetchError) {
    try {
      return await openCurlSession();
    } catch (curlError) {
      throw new Error(`fetch: ${(fetchError as Error).message}; curl: ${(curlError as Error).message}`);
    }
  }
}

function listFiles(): string[] {
  return fs.existsSync(dir()) ? fs.readdirSync(dir()).filter((f) => /^moi-low-use-.*\.csv$/.test(f)).sort() : [];
}

export const lowUse: Source = {
  id: 'low-use',
  title: 'MOI low-use (low electricity use) housing counts and rates by district, half-yearly, Taipei and New Taipei',
  async download({ force }) {
    const todo = GROUPS.flatMap((g) => g.periods.flatMap((p) => COUNTIES.map((c) => ({ g, p, c }))))
      .filter(({ g, p, c }) => force || !fs.existsSync(dir(fileName(g, p, c.code))));
    console.log(`  ${todo.length} files to fetch (${GROUPS.map((g) => `${g.id}: ${g.periods.length} periods`).join(', ')}; ${COUNTIES.length} counties)`);
    if (todo.length === 0) return;
    const session = await openSession();
    fs.mkdirSync(dir(), { recursive: true });
    for (const { g, p, c } of todo) {
      const label = `${g.id} ${p} ${c.name}`;
      try {
        const body = await session.post(g.form, p, c.code);
        const problem = validateCsv(body);
        if (problem) {
          logResult(label, { status: 'failed', error: problem });
        } else {
          fs.writeFileSync(dir(fileName(g, p, c.code)), body);
          logResult(label, { status: 'downloaded', bytes: body.length });
        }
      } catch (e) {
        logResult(label, { status: 'failed', error: (e as Error).message });
      }
      await sleep(300);
    }
  },
  async check() {
    const files = listFiles();
    if (files.length === 0) {
      console.log('  no files in data/raw/low-use/ (run: node scripts/download.ts low-use)');
      return;
    }
    // method group id -> period -> district code -> count
    const found = new Map<string, Map<string, Map<string, number>>>();
    for (const f of files) {
      const m = f.match(/^moi-low-use-([a-z]+)-(\w+)-\d+\.csv$/);
      if (!m) continue;
      let rows: LowUseRow[];
      try {
        rows = parseLowUseCsv(fs.readFileSync(dir(f), 'utf8'));
      } catch (e) {
        console.log(`  ${f}: ${(e as Error).message}`);
        continue;
      }
      const periods = found.get(m[1]!) ?? new Map<string, Map<string, number>>();
      found.set(m[1]!, periods);
      const period = toLowUsePeriod(m[2]!) ?? m[2]!;
      const byDistrict = periods.get(period) ?? new Map<string, number>();
      periods.set(period, byDistrict);
      for (const r of rows) {
        const d = districtByZh(r.zh);
        if (d && Number.isFinite(r.count)) byDistrict.set(d.code, r.count);
      }
    }
    for (const group of GROUPS) {
      const periods = found.get(group.id);
      if (!periods) continue;
      console.log(`${group.label} (${group.form}): ${periods.size} periods; a period named by an annual ROC year (before 109) is listed as H2 (Nov-Dec basis)`);
      for (const period of [...periods.keys()].sort()) {
        const byDistrict = periods.get(period)!;
        const missing = DISTRICTS.filter((d) => !byDistrict.has(d.code)).map((d) => d.code);
        console.log(`  ${period}: ${byDistrict.size} of ${DISTRICTS.length} districts with a value; without a value: ${missing.length === 0 ? '(none)' : missing.join(' ')}`);
      }
    }
  },
};
