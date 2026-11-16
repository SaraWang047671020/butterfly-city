/**
 * HTTP helpers for the download scripts.
 *
 * Some government sites (pip.moi.gov.tw, nthurc.org.tw, airtw.moenv.gov.tw) put a web application
 * firewall in front that rejects non-browser clients. Requests therefore send a browser User-Agent,
 * and `downloadFile` falls back to the system `curl` (available in PowerShell and Git Bash on
 * Windows 10+) when Node's fetch is rejected.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface DownloadOptions {
  /** Extra request headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Skip the request when the file exists and is at least this many bytes. Default 1. */
  readonly minBytes?: number;
  /** Re-download even if the file exists. */
  readonly force?: boolean;
  /** Validates the downloaded bytes; return an error message to reject the file. */
  readonly validate?: (body: Buffer) => string | undefined;
}

export type DownloadResult =
  | { readonly status: 'skipped' | 'downloaded'; readonly bytes: number }
  | { readonly status: 'failed'; readonly error: string };

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const WAF_REJECTION = /Request Rejected|The requested URL was rejected/;

class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function fetchBuffer(url: string, headers: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, ...headers } });
  if (!res.ok) throw new HttpStatusError(res.status);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 2000 && WAF_REJECTION.test(body.toString('utf8'))) throw new Error('rejected by firewall');
  return body;
}

async function curlBuffer(url: string, headers: Record<string, string>): Promise<Buffer> {
  const args = ['-s', '-L', '--fail', '-A', BROWSER_UA];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  try {
    const { stdout } = await execFileAsync('curl', args, { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 });
    if (stdout.length < 2000 && WAF_REJECTION.test(stdout.toString('utf8'))) throw new Error('rejected by firewall');
    return stdout;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    throw new Error(typeof code === 'number' ? `curl exit code ${code}` : (e as Error).message.split('\n')[0]);
  }
}

/** GETs a URL as a Buffer, falling back to curl when fetch is blocked (not for 404 / 410). */
export async function getBuffer(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  try {
    return await fetchBuffer(url, headers);
  } catch (fetchError) {
    if (fetchError instanceof HttpStatusError && (fetchError.status === 404 || fetchError.status === 410)) throw fetchError;
    try {
      return await curlBuffer(url, headers);
    } catch (curlError) {
      throw new Error(`fetch: ${(fetchError as Error).message}; curl: ${(curlError as Error).message}`);
    }
  }
}

export async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  return (await getBuffer(url, headers)).toString('utf8');
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return JSON.parse(await getText(url, headers)) as T;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for POST ${url}`);
  return (await res.json()) as T;
}

/** Downloads `url` to `dest` (creating parent directories). Never throws; returns a result. */
export async function downloadFile(url: string, dest: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const minBytes = options.minBytes ?? 1;
  if (!options.force && fs.existsSync(dest) && fs.statSync(dest).size >= minBytes) {
    return { status: 'skipped', bytes: fs.statSync(dest).size };
  }
  try {
    const body = await getBuffer(url, { ...(options.headers ?? {}) });
    const problem = options.validate?.(body);
    if (problem) return { status: 'failed', error: problem };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    return { status: 'downloaded', bytes: body.length };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

/** Rejects HTML error pages served with status 200 in place of a data file. */
export function notHtml(body: Buffer): string | undefined {
  const head = body.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') ? 'got an HTML page instead of a data file' : undefined;
}

export function isPdf(body: Buffer): string | undefined {
  return body.subarray(0, 4).toString('latin1') === '%PDF' ? undefined : 'not a PDF';
}
